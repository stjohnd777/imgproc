"""Render a stereo trajectory using the shared SynC scene schema."""

import argparse
import copy
import math
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "SynC" / "pylib"))
from scene_config import (  # noqa: E402
    apply_camera_spec,
    finite_number,
    load_scene_params,
    validate_scene_params,
)
from render_scene import render_scene  # noqa: E402


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
            if trajectory["type"] != "linear":
                raise ValueError("--start/--stop require a linear trajectory.")
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
    if trajectory["type"] == "orbit":
        raise ValueError(
            "Use the universal render_scene.py driver for camera-rig orbit."
        )
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
    points = (
        trajectory["waypoints_m"]
        if trajectory["type"] == "piecewise_linear"
        else [trajectory["start_position_m"], trajectory["end_position_m"]]
    )
    for point in points:
        if point[1] <= camera_y:
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
    if params["trajectory"]["type"] == "orbit":
        raise ValueError(
            "Use the universal render_scene.py driver for camera-rig orbit."
        )
    if camera_spec:
        spec_path = Path(camera_spec)
        if not spec_path.is_absolute():
            spec_path = PROJECT_ROOT / spec_path
        params = apply_camera_spec(params, spec_path)
    params = apply_ingress_overrides(params, params_override or {})
    validate_stereo_trajectory(params)

    return render_scene(
        params,
        output_dir or SCRIPT_DIR,
        models_dir=PROJECT_ROOT / "SynC" / "models",
        dry_run=dry_run,
        prefix="ingress_stereo",
        camera_directories=["left", "right"],
        require_disparity=True,
    )


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
