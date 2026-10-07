"""Circular camera-rig motion around a fixed target in world coordinates."""

import math

from mathutils import Matrix, Quaternion, Vector

from scene_config import finite_number, vector3


class CameraRigOrbit:
    """Capture a rigid rig and move it around a target's transform origin.

    The rig origin is the camera-position centroid; its initial orientation
    is the first camera's world rotation. The initial target-to-centroid
    vector defines angle zero and must lie in the orbit plane. Positive
    angles use the right-hand rule around ``axis_world``.

    With ``track_target=True``, the rig's local -Z points at the target and
    local +Y follows the orbit normal. Every camera retains its transform
    relative to the rig; cameras are not independently toed in.
    """

    def __init__(
        self,
        cameras,
        target_matrix,
        *,
        radius_m=None,
        axis_world=(0.0, 0.0, 1.0),
        start_angle_deg=0.0,
        sweep_angle_deg=360.0,
        track_target=True,
    ):
        self.cameras = tuple(cameras)
        if not self.cameras:
            raise ValueError("An orbit requires at least one camera.")
        if len(set(self.cameras)) != len(self.cameras):
            raise ValueError("Orbit cameras must be distinct.")
        if any(camera.type != "CAMERA" for camera in self.cameras):
            raise TypeError("All rig members must be Blender cameras.")
        if any(camera.constraints for camera in self.cameras):
            raise ValueError(
                "Constrained cameras are not supported for orbit."
            )
        if any(camera.parent in self.cameras for camera in self.cameras):
            raise ValueError("Orbit cameras must not parent one another.")
        if not isinstance(track_target, bool):
            raise ValueError("track_target must be a boolean.")
        finite_number(start_angle_deg, "start_angle_deg")
        finite_number(sweep_angle_deg, "sweep_angle_deg")
        vector3(axis_world, "axis_world")
        axis_length = math.hypot(*axis_world)
        if axis_length == 0 or not math.isfinite(axis_length):
            raise ValueError("axis_world must be nonzero.")
        self.axis = Vector(
            [component / axis_length for component in axis_world]
        )
        target = Matrix(target_matrix)
        if len(target) != 4 or any(len(row) != 4 for row in target):
            raise ValueError("target_matrix must be a 4x4 world transform.")
        if not all(math.isfinite(value) for row in target for value in row):
            raise ValueError("target_matrix must contain finite values.")
        self.center = target.translation.copy()
        matrices = tuple(camera.matrix_world.copy() for camera in self.cameras)
        if not all(
            math.isfinite(value)
            for matrix in matrices
            for row in matrix
            for value in row
        ):
            raise ValueError("Camera world transforms must be finite.")
        centroid = Vector(
            [
                sum(matrix.translation[axis] for matrix in matrices)
                / len(matrices)
                for axis in range(3)
            ]
        )
        radial = centroid - self.center
        if radial.length == 0:
            raise ValueError("Rig center and target must be different.")
        self.radial_direction = radial.normalized()
        if abs(self.radial_direction.dot(self.axis)) > 1e-6:
            raise ValueError(
                "Initial rig-to-target vector must be perpendicular to "
                "axis_world; choose a normal for the desired orbit plane."
            )
        self.radius_m = (
            radial.length
            if radius_m is None
            else finite_number(radius_m, "radius_m", positive=True)
        )
        finite_number(self.radius_m, "radius_m", positive=True)
        self.start_angle = math.radians(start_angle_deg)
        self.sweep_angle = math.radians(sweep_angle_deg)
        self.arc_length = self.radius_m * abs(self.sweep_angle)
        if not math.isfinite(self.arc_length):
            raise ValueError("Orbit arc length must be finite.")
        self.track_target = track_target
        self.initial_rotation = matrices[0].to_quaternion().to_matrix()
        initial_rig = self.initial_rotation.to_4x4()
        initial_rig.translation = centroid
        inverse = initial_rig.inverted()
        self.relative_transforms = tuple(
            inverse @ matrix for matrix in matrices
        )

    def position_at(self, t):
        """Return the rig-center position at normalized angular progress."""
        finite_number(t, "t")
        if not 0 <= t <= 1:
            raise ValueError("t must be in [0, 1].")
        angle = self.start_angle + self.sweep_angle * t
        # Reducing modulo a turn also makes full-orbit endpoints coincide.
        rotation = Quaternion(self.axis, math.remainder(angle, math.tau))
        position = (
            self.center + rotation @ self.radial_direction * self.radius_m
        )
        if not all(math.isfinite(value) for value in position):
            raise ValueError(
                "Orbit position exceeds Blender coordinate range."
            )
        if (position - self.center).length == 0:
            raise ValueError(
                "Orbit radius is too small for Blender coordinate precision."
            )
        return position

    def matrix_at(self, t):
        """Return the rig's world transform without modifying any object."""
        position = self.position_at(t)
        if self.track_target:
            forward = (self.center - position).normalized()
            right = forward.cross(self.axis).normalized()
            up = right.cross(forward).normalized()
            rotation = Matrix((right, up, -forward)).transposed()
        else:
            rotation = self.initial_rotation
        result = rotation.to_4x4()
        result.translation = position
        return result

    def apply(self, t):
        """Apply an absolute orbit sample to every camera as one rigid rig."""
        rig_matrix = self.matrix_at(t)
        for camera, relative in zip(self.cameras, self.relative_transforms):
            camera.matrix_world = rig_matrix @ relative
        return rig_matrix
