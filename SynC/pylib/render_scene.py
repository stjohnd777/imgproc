"""Universal JSON-driven static and trajectory rendering for SynC."""

import argparse
import copy
import json
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingress_egress import (  # noqa: E402
    LinearSegment,
    PiecewiseLinearPath,
    move_object_along_path,
)
from scene_config import (  # noqa: E402
    apply_camera_spec,
    load_scene_params,
    safe_filename,
    validate_scene_params,
)
from scene_setup import build_scene, render_camera  # noqa: E402
from orbit import CameraRigOrbit  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def trajectory_path(motion):
    if motion["type"] == "linear":
        return LinearSegment(
            motion["start_position_m"], motion["end_position_m"]
        )
    if motion["type"] == "piecewise_linear":
        return PiecewiseLinearPath(motion["waypoints_m"])
    raise ValueError(f"Unsupported trajectory type: {motion['type']!r}")


def trajectory_samples(path, max_step):
    """Return path parameters and step lengths, retaining every corner."""
    segments = (
        path.segments if isinstance(path, PiecewiseLinearPath) else (path,)
    )
    lengths = [math.dist(segment.p0, segment.p1) for segment in segments]
    total = sum(lengths)
    if total == 0:
        return [0.0], []
    parameters = [0.0]
    steps = []
    traversed = 0.0
    for length in lengths:
        if length == 0:
            continue
        count = math.ceil(length / max_step)
        parameters.extend(
            (traversed + length * index / count) / total
            for index in range(1, count + 1)
        )
        steps.extend([length / count] * count)
        traversed += length
    parameters[-1] = 1.0
    return parameters, steps


def render_static_views(scene, cameras, output_dir, prefix, *, dry_run=False):
    """Save a static scene and render each camera once."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_filename(prefix, "prefix")
    names = [
        safe_filename(camera.name.lower(), "camera name") for camera in cameras
    ]
    if len(set(names)) != len(names):
        raise ValueError("Camera names collide when used as output filenames.")
    scene.camera = cameras[0]
    bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / f"{prefix}.blend"))
    images = {}
    for camera, name in zip(cameras, names):
        stem = output_dir / f"{prefix}_{name}"
        images[camera.name] = stem.name + scene.render.file_extension
        if not dry_run:
            render_camera(scene, camera, stem)
    return images


def _rectified_metrics(params, scene):
    """Return disparity calibration only for the supported rectified rig."""
    rig = params["camera_rig"]
    configs = rig["cameras"]
    if (
        len(configs) != 2
        or "baseline_m" not in rig
        or not rig.get("parallel_optical_axes", False)
    ):
        return None
    left, right = configs
    for camera in configs:
        pose = camera["pose"]
        if (
            camera["sensor_fit"] != "HORIZONTAL"
            or pose.get("rotation_order", "XYZ") != "XYZ"
            or any(
                abs(a - b) > 1e-9
                for a, b in zip(
                    pose["rotation_euler_rad"], (math.pi / 2, 0, 0)
                )
            )
        ):
            return None
    if any(
        left[field] != right[field]
        for field in ("focal_length_mm", "sensor_width_mm", "sensor_height_mm")
    ):
        return None
    width = (
        scene.render.resolution_x * scene.render.resolution_percentage // 100
    )
    return {
        "fx": left["focal_length_mm"] / left["sensor_width_mm"] * width,
        "baseline": rig["baseline_m"],
        "camera_y": left["pose"]["translation_m"][1],
    }


def render_scene(
    params,
    output_dir,
    *,
    models_dir=None,
    dry_run=False,
    prefix=None,
    camera_directories=None,
    log_filename=None,
    require_disparity=False,
):
    """Render any configured camera count, once or over a spatial path.

    No trajectory means one view per camera. Linear paths move a model;
    orbit moves the rigid camera rig around a fixed model. The Sun is fixed.
    Compatibility wrappers may supply their established output names.
    """
    params = copy.deepcopy(validate_scene_params(params))
    output_dir = Path(output_dir)
    prefix = (
        params.get("output", {}).get("prefix", "scene")
        if prefix is None
        else prefix
    )
    safe_filename(prefix, "output prefix")
    motion = params.get("trajectory")
    is_orbit = motion is not None and motion["type"] == "orbit"
    if is_orbit and require_disparity:
        raise ValueError(
            "The ingress disparity output is not supported for rig orbit."
        )
    path = trajectory_path(motion) if motion and not is_orbit else None
    configs = params["camera_rig"]["cameras"]
    output_config = params.get("output", {})
    configured_directories = output_config.get("camera_directories", {})
    directories = (
        camera_directories
        if camera_directories is not None
        else [
            configured_directories.get(config["name"], config["name"])
            for config in configs
        ]
    )
    if len(directories) != len(configs):
        raise ValueError("One output directory is required per camera.")
    for name in directories:
        safe_filename(name, "camera output directory")
    if len({name.casefold() for name in directories}) != len(directories):
        raise ValueError("Camera output directories must be distinct.")
    filename = (
        log_filename
        if log_filename is not None
        else output_config.get(
            "log_filename",
            (
                "ground_truth_trajectory.json"
                if motion
                else "render_manifest.json"
            ),
        )
    )
    safe_filename(filename, "log filename")
    scene, cameras, models = build_scene(
        params, models_dir or PROJECT_ROOT / "SynC" / "models"
    )
    orbit = None
    if is_orbit:
        target = models[motion["target"]]
        orbit = CameraRigOrbit(
            cameras,
            target.matrix_world,
            radius_m=motion.get("radius_m"),
            axis_world=motion.get("axis_world", (0, 0, 1)),
            start_angle_deg=motion.get("start_angle_deg", 0),
            sweep_angle_deg=motion.get("sweep_angle_deg", 360),
            track_target=motion.get("track_target", True),
        )
        count = max(1, math.ceil(orbit.arc_length / motion["max_step_m"]) + 1)
        parameters = [
            index / (count - 1) if count > 1 else 0 for index in range(count)
        ]
        steps = (
            [orbit.arc_length / (count - 1)] * (count - 1) if count > 1 else []
        )
        orbit.apply(0)
        scene.view_layers[0].update()
    else:
        target = models[motion["object"]] if motion else None
        parameters, steps = (
            trajectory_samples(path, motion["max_step_m"])
            if motion
            else ([0.0], [])
        )
        count = len(parameters)
    step = max(steps, default=0.0)
    metrics = None if is_orbit else _rectified_metrics(params, scene)
    if require_disparity and (metrics is None or not motion):
        raise ValueError("This output requires a rectified stereo trajectory.")
    if require_disparity:
        points = (
            motion["waypoints_m"]
            if motion["type"] == "piecewise_linear"
            else [motion["start_position_m"], motion["end_position_m"]]
        )
        if any(point[1] <= metrics["camera_y"] for point in points):
            raise ValueError(
                "Disparity requires a target in front of cameras."
            )
    if path:
        move_object_along_path(target, path, 0)
        scene.view_layers[0].update()
    output_dir.mkdir(parents=True, exist_ok=True)
    log = {
        "metadata": {
            "schema_version": 1,
            "name": params["scene"]["name"],
            "sun": params["environment"]["sun"],
            "scene_params": params,
            "dry_run": dry_run,
            "totalFrames": count,
            "disparity_available": metrics is not None and motion is not None,
        },
        "frames": [],
    }
    if motion:
        log["metadata"]["targetModel"] = next(
            model["file"]
            for model in params["models"]
            if model["name"] == motion["target" if is_orbit else "object"]
        )
        log["metadata"]["trajectory"] = {
            **motion,
            "stepMeters": step,
            "requestedMaxStepMeters": motion["max_step_m"],
            "totalFrames": count,
        }
        if is_orbit:
            log["metadata"]["trajectory"].update(
                radius_m=orbit.radius_m,
                axis_world=list(orbit.axis),
                track_target=orbit.track_target,
                moved_entity="camera_rig",
                arcLengthMeters=orbit.arc_length,
            )
        if metrics:
            start = path.position_at(0).y - metrics["camera_y"]
            end = path.position_at(1).y - metrics["camera_y"]
            log["metadata"]["trajectory"].update(
                startDistanceMeters=start, endDistanceMeters=end
            )
            left = configs[0]
            log["metadata"]["camera"] = {
                "name": params["camera_rig"]["name"],
                "resolution": {
                    "width": scene.render.resolution_x
                    * scene.render.resolution_percentage
                    // 100,
                    "height": scene.render.resolution_y
                    * scene.render.resolution_percentage
                    // 100,
                },
                "focalLengthMm": left["focal_length_mm"],
                "sensorWidthMm": left["sensor_width_mm"],
                "fx_pixels": round(metrics["fx"], 2),
                "baselineMm": metrics["baseline"] * 1000,
            }
        else:
            log["metadata"]["disparity_unavailable_reason"] = (
                "World-Y ingress disparity is not used for camera-rig orbit."
                if is_orbit
                else (
                    "Camera geometry does not meet rectified "
                    "stereo assumptions."
                )
            )
        for directory in directories:
            (output_dir / directory).mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(
            filepath=str(output_dir / f"{prefix}.blend")
        )
    else:
        images = render_static_views(
            scene, cameras, output_dir, prefix, dry_run=dry_run
        )
    for index in range(count):
        frame = {"frame": index + 1}
        if motion:
            t = parameters[index]
            if orbit:
                rig_matrix = orbit.apply(t)
                position = rig_matrix.translation
                frame["rigToWorld"] = [list(row) for row in rig_matrix]
                frame["rigCenterWorldMeters"] = [round(v, 6) for v in position]
            else:
                position = move_object_along_path(target, path, t)
            scene.view_layers[0].update()
            frame["positionWorldMeters"] = [round(v, 6) for v in position]
            frame["stepMeters"] = steps[index - 1] if index else 0.0
            images = {}
            stem = f"frame_{index + 1:04d}"
            for directory, camera in zip(directories, cameras):
                images[camera.name] = (
                    f"{directory}/{stem}{scene.render.file_extension}"
                )
                if not dry_run:
                    render_camera(scene, camera, output_dir / directory / stem)
            if metrics:
                depth = position.y - metrics["camera_y"]
                frame["distanceMeters"] = depth
                if depth > 0:
                    frame["theoreticalCenterDisparityPx"] = round(
                        metrics["fx"] * metrics["baseline"] / depth, 3
                    )
                else:
                    frame["disparity_unavailable_reason"] = (
                        "Target origin is not in front of the stereo cameras."
                    )
        frame["images"] = images
        if directories == ["left", "right"] and len(cameras) == 2:
            frame["leftImage"], frame["rightImage"] = images.values()
        frame["cameraToWorld"] = {
            camera.name: [list(row) for row in camera.matrix_world]
            for camera in cameras
        }
        frame["modelToWorld"] = {
            name: [list(row) for row in model.matrix_world]
            for name, model in models.items()
        }
        log["frames"].append(frame)
        if index == 0 or index == count - 1 or (index + 1) % 10 == 0:
            print(f"[{index + 1}/{count}] {len(cameras)} camera views")
    with open(output_dir / filename, "w", encoding="utf-8") as log_file:
        json.dump(log, log_file, indent=2)
    return log


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--params", required=True, help="Scene JSON file.")
    parser.add_argument("--output-dir", help="Default: params file directory.")
    parser.add_argument("--models-dir", help="Override model asset directory.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--camera-spec", help="Project-relative camera profile."
    )
    parser.add_argument("--azimuth", type=float)
    parser.add_argument("--elevation", type=float)
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    params = load_scene_params(args.params)
    if args.camera_spec:
        path = Path(args.camera_spec)
        params = apply_camera_spec(
            params, path if path.is_absolute() else PROJECT_ROOT / path
        )
    for field, value in (
        ("azimuth_deg", args.azimuth),
        ("elevation_deg", args.elevation),
    ):
        if value is not None:
            sun = params["environment"]["sun"]
            if not sun.get("enabled"):
                raise ValueError("Sun angle overrides require an enabled Sun.")
            sun["direction"][field] = value
    render_scene(
        params,
        args.output_dir or Path(args.params).resolve().parent,
        models_dir=args.models_dir,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
