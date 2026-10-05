"""Reusable linear target motion helpers for Blender scene generation."""

import math
import mathutils

from camera_look_at import camera_look_at


def _as_finite_vector3(value, name):
    try:
        vector = mathutils.Vector(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{name} must contain three finite coordinates."
        ) from exc

    if len(vector) != 3 or not all(
        math.isfinite(component) for component in vector
    ):
        raise ValueError(f"{name} must contain three finite coordinates.")
    return vector


def _validate_sample_count(num_samples):
    if (
        isinstance(num_samples, bool)
        or not isinstance(num_samples, int)
        or num_samples < 1
    ):
        raise ValueError("num_samples must be a positive integer.")


class LinearSegment:
    """A world-space straight-line segment parameterized by ``t`` in [0, 1]."""

    def __init__(self, p0, p1):
        self.p0 = _as_finite_vector3(p0, "p0")
        self.p1 = _as_finite_vector3(p1, "p1")

    def position_at(self, t):
        """Return the position at normalized segment parameter ``t``."""
        if not math.isfinite(t) or not 0.0 <= t <= 1.0:
            raise ValueError(
                "t must be finite and in the inclusive range [0, 1]."
            )
        # Round to mathutils precision once, not at each vector operation.
        return mathutils.Vector(
            [
                start * (1.0 - t) + end * t
                for start, end in zip(self.p0, self.p1)
            ]
        )

    def sample(self, num_samples):
        """Return evenly spaced points, including both endpoints."""
        _validate_sample_count(num_samples)
        if num_samples == 1:
            if self.p0 != self.p1:
                raise ValueError(
                    "A moving segment needs at least two samples."
                )
            return [self.p0.copy()]
        return [
            self.position_at(index / (num_samples - 1))
            for index in range(num_samples)
        ]


class PiecewiseLinearPath:
    """A world-space polyline parameterized uniformly by traveled distance."""

    def __init__(self, waypoints):
        points = tuple(
            _as_finite_vector3(point, f"waypoints[{index}]")
            for index, point in enumerate(waypoints)
        )
        if len(points) < 2:
            raise ValueError("A piecewise path needs at least two waypoints.")

        self.waypoints = points
        self.segments = tuple(
            LinearSegment(p0, p1) for p0, p1 in zip(points, points[1:])
        )
        self.segment_lengths = tuple(
            segment.p0.distance(segment.p1) for segment in self.segments
        )
        self.total_length = sum(self.segment_lengths)

    def position_at(self, t):
        """Return the point at normalized arc-length parameter ``t``."""
        if not math.isfinite(t) or not 0.0 <= t <= 1.0:
            raise ValueError(
                "t must be finite and in the inclusive range [0, 1]."
            )
        if self.total_length == 0.0:
            return self.waypoints[0].copy()
        if t == 1.0:
            return self.waypoints[-1].copy()

        distance = t * self.total_length
        traversed = 0.0
        for segment, segment_length in zip(
            self.segments, self.segment_lengths
        ):
            if segment_length == 0.0:
                continue
            segment_end = traversed + segment_length
            if distance <= segment_end:
                local_t = (distance - traversed) / segment_length
                return segment.position_at(local_t)
            traversed = segment_end

        return self.waypoints[-1].copy()

    def sample(self, num_samples):
        """Return evenly spaced samples, including both endpoints."""
        _validate_sample_count(num_samples)
        if num_samples == 1:
            if self.total_length != 0.0:
                raise ValueError("A moving path needs at least two samples.")
            return [self.waypoints[0].copy()]
        return [
            self.position_at(index / (num_samples - 1))
            for index in range(num_samples)
        ]


def move_object_along_path(obj, path, t, cameras_to_track=()):
    """Move an object along a path and optionally aim cameras at it.

    The object's orientation and scale are retained. Cameras are only aimed
    when explicitly supplied; leaving them parallel is often required for a
    rectified stereo rig.
    """
    if not isinstance(path, (LinearSegment, PiecewiseLinearPath)):
        raise TypeError("path must be a LinearSegment or PiecewiseLinearPath.")

    world_transform = obj.matrix_world.copy()
    position = path.position_at(t)
    world_transform.translation = position
    obj.matrix_world = world_transform

    cameras = tuple(cameras_to_track)
    if cameras:
        for camera in cameras:
            camera_look_at(camera, obj.matrix_world.copy())

    return position
