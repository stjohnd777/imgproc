"""Render a stereo trajectory using the shared SynC scene schema."""

import argparse
import copy
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "SynC" / "pylib"))
from ingress_egress import LinearSegment, move_object_along_path  # noqa: E402
from scene_config import (  # noqa: E402
    apply_camera_spec,
    finite_number,
    load_scene_params,
    validate_scene_params,
)
from scene_setup import build_scene, render_camera  # noqa: E402


def apply_ingress_overrides(params, overrides):
    """Translate the existing CLI/programmatic overrides into schema v1."""
    params = copy.deepcopy(params)
    trajectory = params["trajectory"]
    target = next(
        model
        for model in params["models"]
        if model["name"] == trajectory["object"]
    )
    for key, value in overrides.items():
        if value is None:
            continue
        if key in {"start", "stop"}:
            finite_number(value, key, positive=True)
            endpoint = (
                "start_position_m" if key == "start" else "end_position_m"
            )
            trajectory[endpoint][1] = value
        elif key == "increment":
            trajectory["max_step_m"] = value
        elif key == "target_model":
            target["file"] = value
        elif key == "name":
            params["scene"]["name"] = value
        elif key == "sun":
            sun = params["environment"]["sun"]
            for field, setting in value.items():
                if field in {"azimuth_deg", "elevation_deg"}:
                    sun["direction"][field] = setting
                elif field in {
                    "energy",
                    "temperature_k",
                    "apparent_diameter_deg",
                }:
                    mapped = {
                        "energy": "blender_energy",
                        "temperature_k": "color_temperature_k",
                        "apparent_diameter_deg": (
                            "apparent_angular_diameter_deg"
                        ),
                    }
                    sun[mapped[field]] = setting
                else:
                    raise ValueError(f"Unsupported Sun override: {field}")
        elif key == "camera":
            _apply_camera_overrides(params, value)
        elif key == "render":
            params["scene"]["render"].update(value)
        else:
            raise ValueError(f"Unsupported ingress override: {key}")
    return validate_scene_params(params)


def _apply_camera_overrides(params, overrides):
    rig = params["camera_rig"]
    for field, value in overrides.items():
        if field == "spec":
            raise ValueError("Use camera_spec or --camera-spec for profiles.")
        if field == "name":
            rig["name"] = value
        elif field == "resolution":
            params["scene"]["render"]["resolution_px"] = [
                value["width"],
                value["height"],
            ]
        elif field == "baseline_mm":
            finite_number(value, "baseline_mm", positive=True)
            rig["baseline_m"] = value / 1000
            center = (
                sum(
                    camera["pose"]["translation_m"][0]
                    for camera in rig["cameras"]
                )
                / 2
            )
            for camera, sign in zip(rig["cameras"], (-1, 1)):
                camera["pose"]["translation_m"][0] = (
                    center + sign * rig["baseline_m"] / 2
                )
        elif field in {"lens_focal_length_mm", "sensor_size_mm"}:
            for camera in rig["cameras"]:
                if field == "lens_focal_length_mm":
                    camera["focal_length_mm"] = value
                else:
                    camera["sensor_width_mm"] = value["width"]
                    camera["sensor_height_mm"] = value["height"]
        else:
            raise ValueError(f"Unsupported camera override: {field}")


def validate_stereo_trajectory(params):
    """Enforce the rectified rig assumptions behind the disparity log."""
    trajectory = params.get("trajectory")
    if trajectory is None:
        raise ValueError("The ingress driver requires a trajectory section.")
    rig = params["camera_rig"]
    cameras = rig["cameras"]
    if (
        len(cameras) != 2
        or not rig.get("parallel_optical_axes")
        or "baseline_m" not in rig
    ):
        raise ValueError("Ingress requires a parallel two-camera stereo rig.")
    left, right = cameras
    for camera in cameras:
        pose = camera["pose"]
        if (
            camera["sensor_fit"] != "HORIZONTAL"
            or pose.get("rotation_order", "XYZ") != "XYZ"
            or any(
                abs(actual - expected) > 1e-9
                for actual, expected in zip(
                    pose["rotation_euler_rad"], (math.pi / 2, 0, 0)
                )
            )
        ):
            raise ValueError(
                "Ingress disparity logging requires HORIZONTAL cameras "
                "looking along world +Y with +Z up."
            )
    for field in ("focal_length_mm", "sensor_width_mm", "sensor_height_mm"):
        if left[field] != right[field]:
            raise ValueError(
                "Ingress stereo cameras must have matching optics."
            )
    camera_y = left["pose"]["translation_m"][1]
    for endpoint in ("start_position_m", "end_position_m"):
        if trajectory[endpoint][1] <= camera_y:
            raise ValueError(
                "Trajectory endpoints must be in front of cameras."
            )


def run_ingress(
    params_override=None,
    dry_run=False,
    *,
    params_path=None,
    output_dir=None,
    camera_spec=None,
):
    params = load_scene_params(params_path or SCRIPT_DIR / "params.json")
    if "trajectory" not in params:
        raise ValueError("The ingress driver requires a trajectory section.")
    if camera_spec:
        spec_path = Path(camera_spec)
        if not spec_path.is_absolute():
            spec_path = PROJECT_ROOT / spec_path
        params = apply_camera_spec(params, spec_path)
    params = apply_ingress_overrides(params, params_override or {})
    validate_stereo_trajectory(params)

    motion = params["trajectory"]
    start = Vector(motion["start_position_m"])
    end = Vector(motion["end_position_m"])
    path = LinearSegment(start, end)
    length = (end - start).length
    total_frames = max(1, math.ceil(length / motion["max_step_m"]) + 1)
    step = length / (total_frames - 1) if total_frames > 1 else 0.0

    scene, cameras, models = build_scene(
        params, PROJECT_ROOT / "SynC" / "models"
    )
    target = models[motion["object"]]
    move_object_along_path(target, path, 0.0)
    scene.view_layers[0].update()
    output_dir = Path(output_dir or SCRIPT_DIR)
    for side in ("left", "right"):
        (output_dir / side).mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(
        filepath=str(output_dir / "ingress_stereo.blend")
    )

    left = params["camera_rig"]["cameras"][0]
    camera_y = left["pose"]["translation_m"][1]
    baseline_m = params["camera_rig"]["baseline_m"]
    width = (
        scene.render.resolution_x * scene.render.resolution_percentage // 100
    )
    height = (
        scene.render.resolution_y * scene.render.resolution_percentage // 100
    )
    fx_px = left["focal_length_mm"] / left["sensor_width_mm"] * width
    start_depth, end_depth = start.y - camera_y, end.y - camera_y
    motion_name = (
        "ingress"
        if start_depth > end_depth
        else (
            "egress"
            if start_depth < end_depth
            else "stationary" if length == 0 else "translation"
        )
    )
    target_config = next(
        model
        for model in params["models"]
        if model["name"] == motion["object"]
    )
    log = {
        "metadata": {
            "schema_version": 1,
            "name": params["scene"]["name"],
            "targetModel": target_config["file"],
            "sun": params["environment"]["sun"],
            "scene_params": params,
            "camera": {
                "name": params["camera_rig"]["name"],
                "resolution": {"width": width, "height": height},
                "focalLengthMm": left["focal_length_mm"],
                "sensorWidthMm": left["sensor_width_mm"],
                "fx_pixels": round(fx_px, 2),
                "baselineMm": baseline_m * 1000,
            },
            "trajectory": {
                **motion,
                "startDistanceMeters": start_depth,
                "endDistanceMeters": end_depth,
                "stepMeters": step,
                "requestedMaxStepMeters": motion["max_step_m"],
                "totalFrames": total_frames,
            },
        },
        "frames": [],
    }
    print(f"{motion_name}: {total_frames} stereo pairs, max step {step:.6f}m")
    for index in range(total_frames):
        t = index / (total_frames - 1) if total_frames > 1 else 0.0
        position = move_object_along_path(target, path, t)
        depth = position.y - camera_y
        frame = index + 1
        stem = f"frame_{frame:04d}"
        names = [
            f"{side}/{stem}{scene.render.file_extension}"
            for side in ("left", "right")
        ]
        log["frames"].append(
            {
                "frame": frame,
                "distanceMeters": depth,
                "positionWorldMeters": [round(value, 6) for value in position],
                "theoreticalCenterDisparityPx": round(
                    fx_px * baseline_m / depth, 3
                ),
                "leftImage": names[0],
                "rightImage": names[1],
            }
        )
        if not dry_run:
            scene.view_layers[0].update()
            for side, camera in zip(("left", "right"), cameras):
                render_camera(scene, camera, output_dir / side / stem)
        if frame == 1 or frame == total_frames or frame % 10 == 0:
            print(
                f"[{frame}/{total_frames}] Camera-forward depth: {depth:.3f}m"
            )
    with open(
        output_dir / "ground_truth_trajectory.json", "w", encoding="utf-8"
    ) as log_file:
        json.dump(log, log_file, indent=2)
    print("Sequence generation complete!")
    return log


def main():
    parser = argparse.ArgumentParser(
        description="Render a stereo ingress/egress trajectory from schema v1."
    )
    parser.add_argument(
        "--params",
        default=str(SCRIPT_DIR / "params.json"),
        help="Path to shared scene JSON.",
    )
    parser.add_argument(
        "--start", type=float, help="Override start world Y (m)."
    )
    parser.add_argument("--stop", type=float, help="Override end world Y (m).")
    parser.add_argument(
        "--increment", type=float, help="Maximum sample step (m)."
    )
    parser.add_argument(
        "--target-model", help="Override target asset filename."
    )
    parser.add_argument("--azimuth", type=float, help="Sun azimuth (degrees).")
    parser.add_argument(
        "--elevation", type=float, help="Sun elevation (degrees)."
    )
    parser.add_argument(
        "--camera-spec", help="Camera profile path, relative to project root."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Save scene and trajectory log without rendering.",
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    overrides = {
        "start": args.start,
        "stop": args.stop,
        "increment": args.increment,
        "target_model": args.target_model,
        "sun": {
            field: value
            for field, value in (
                ("azimuth_deg", args.azimuth),
                ("elevation_deg", args.elevation),
            )
            if value is not None
        },
    }
    run_ingress(
        overrides,
        args.dry_run,
        params_path=args.params,
        camera_spec=args.camera_spec,
    )


if __name__ == "__main__":
    main()
