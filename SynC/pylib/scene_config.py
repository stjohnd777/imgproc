"""Load and validate the shared, versioned SynC scene configuration."""

import copy
import json
import math
from pathlib import Path


def finite_number(value, name, *, positive=False, nonnegative=False):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError(f"{name} must be a finite number.")
    if positive and value <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    if nonnegative and value < 0:
        raise ValueError(f"{name} must not be negative.")
    return value


def vector3(value, name):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{name} must contain three finite numbers.")
    for component in value:
        finite_number(component, name)
    return value


def _mapping(value, name):
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object.")
    return value


def _positive_integer(value, name):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer.")


def _pose(pose, name):
    _mapping(pose, name)
    if pose.get("frame") != "world":
        raise ValueError(f"{name}.frame must be 'world'.")
    vector3(pose.get("translation_m"), f"{name}.translation_m")
    vector3(pose.get("rotation_euler_rad"), f"{name}.rotation_euler_rad")
    if pose.get("rotation_order", "XYZ") not in {
        "XYZ",
        "XZY",
        "YXZ",
        "YZX",
        "ZXY",
        "ZYX",
    }:
        raise ValueError(f"{name}.rotation_order must be an Euler order.")


def validate_scene_params(params):
    """Validate supported schema-v1 fields before Blender changes the scene."""
    _mapping(params, "params")
    if type(params.get("schema_version")) is not int or (
        params["schema_version"] != 1
    ):
        raise ValueError("Only scene schema_version=1 is supported.")
    for section in ("scene", "camera_rig", "environment"):
        _mapping(params.get(section), section)

    scene = params["scene"]
    if scene.get("units") != "meters":
        raise ValueError("Only scene units='meters' are supported.")
    frame = _mapping(scene.get("world_frame"), "scene.world_frame")
    if (
        frame.get("name") != "world"
        or frame.get("handedness") != "right_handed"
        or frame.get("axes") != {"x": "right", "y": "forward", "z": "up"}
    ):
        raise ValueError(
            "World frame must be right-handed: X right, Y forward, Z up."
        )
    if not isinstance(scene.get("name"), str) or not scene["name"]:
        raise ValueError("scene.name must be a nonempty string.")
    render = _mapping(scene.get("render"), "scene.render")
    resolution = render.get("resolution_px")
    if not isinstance(resolution, list) or len(resolution) != 2:
        raise ValueError("scene.render.resolution_px must have two values.")
    for value in resolution:
        _positive_integer(value, "scene.render.resolution_px")
    percentage = render.get("resolution_percentage", 100)
    _positive_integer(percentage, "scene.render.resolution_percentage")
    if percentage > 100:
        raise ValueError("resolution_percentage must be at most 100.")
    if min(value * percentage // 100 for value in resolution) < 1:
        raise ValueError("Scaled render dimensions must be at least 1 pixel.")
    if not isinstance(render.get("engine"), str):
        raise ValueError("scene.render.engine must be a string.")
    if render.get("image_format") not in {
        "PNG",
        "JPEG",
        "BMP",
        "TIFF",
        "OPEN_EXR",
    }:
        raise ValueError("Unsupported scene.render.image_format.")
    if render.get("color_mode") not in {"BW", "RGB", "RGBA"}:
        raise ValueError("Unsupported scene.render.color_mode.")
    if render.get("color_depth", "8") not in {"8", "16", "32"}:
        raise ValueError("Unsupported scene.render.color_depth.")
    if "samples" in render:
        _positive_integer(render["samples"], "scene.render.samples")

    rig = params["camera_rig"]
    if not isinstance(rig.get("name"), str) or not rig["name"]:
        raise ValueError("camera_rig.name must be a nonempty string.")
    cameras = rig.get("cameras")
    models = params.get("models")
    for entries, name in ((cameras, "camera_rig.cameras"), (models, "models")):
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"{name} must be a nonempty array.")
        names = set()
        for entry in entries:
            _mapping(entry, name)
            entry_name = entry.get("name")
            if not isinstance(entry_name, str) or not entry_name:
                raise ValueError(f"{name} entries need a nonempty name.")
            if entry_name in names:
                raise ValueError(f"Duplicate name in {name}: {entry_name}")
            names.add(entry_name)
            _pose(entry.get("pose"), f"{name}.{entry_name}.pose")
    if {entry["name"] for entry in cameras} & {
        entry["name"] for entry in models
    }:
        raise ValueError("Camera and model names must be distinct.")
    for model in models:
        if not isinstance(model.get("file"), str) or not model["file"]:
            raise ValueError("Each model must specify an asset file.")
    for camera in cameras:
        if (
            camera.get("resolution_x", resolution[0]) != resolution[0]
            or camera.get("resolution_y", resolution[1]) != resolution[1]
        ):
            raise ValueError("Camera resolution must match scene resolution.")
        for field in (
            "focal_length_mm",
            "sensor_width_mm",
            "sensor_height_mm",
        ):
            finite_number(camera.get(field), field, positive=True)
        if camera.get("sensor_fit") not in {"AUTO", "HORIZONTAL", "VERTICAL"}:
            raise ValueError("Unsupported camera sensor_fit.")
        start = finite_number(
            camera.get("clip_start_m", 0.1), "clip_start_m", positive=True
        )
        end = finite_number(
            camera.get("clip_end_m", 2000.0), "clip_end_m", positive=True
        )
        if end <= start:
            raise ValueError("Camera clip_end_m must exceed clip_start_m.")
    if "baseline_m" in rig:
        baseline = finite_number(
            rig["baseline_m"], "baseline_m", positive=True
        )
        if len(cameras) != 2 or rig.get("baseline_axis") != "+X":
            raise ValueError(
                "A stereo baseline requires two cameras along +X."
            )
        left, right = (camera["pose"] for camera in cameras)
        difference = [
            right_value - left_value
            for left_value, right_value in zip(
                left["translation_m"], right["translation_m"]
            )
        ]
        if any(
            abs(actual - expected) > max(1e-9, baseline * 1e-6)
            for actual, expected in zip(difference, (baseline, 0, 0))
        ):
            raise ValueError("Camera positions do not match baseline_m.")
        if rig.get("parallel_optical_axes", False) and (
            left.get("rotation_order", "XYZ")
            != right.get("rotation_order", "XYZ")
            or any(
                abs(left_value - right_value) > 1e-9
                for left_value, right_value in zip(
                    left["rotation_euler_rad"], right["rotation_euler_rad"]
                )
            )
        ):
            raise ValueError("Parallel camera rotations must match.")

    environment = params["environment"]
    background = _mapping(
        environment.get("background"), "environment.background"
    )
    color = vector3(background.get("color_rgb"), "background.color_rgb")
    if any(value < 0 for value in color):
        raise ValueError("Background color must be nonnegative.")
    finite_number(
        background.get("strength"), "background.strength", nonnegative=True
    )
    sun = _mapping(environment.get("sun"), "environment.sun")
    if sun.get("enabled", False):
        direction = _mapping(sun.get("direction"), "sun.direction")
        conventions = {
            "representation": "azimuth_elevation",
            "frame": "world",
            "azimuth_zero_direction": "+Y",
            "azimuth_increases_toward": "+X",
            "elevation_reference_plane": "XY",
            "vector_points": "scene_toward_sun",
        }
        if any(
            direction.get(key) != value for key, value in conventions.items()
        ):
            raise ValueError("Unsupported Sun direction conventions.")
        finite_number(direction.get("azimuth_deg"), "sun.azimuth_deg")
        elevation = finite_number(
            direction.get("elevation_deg"), "sun.elevation_deg"
        )
        if not -90 <= elevation <= 90:
            raise ValueError("Sun elevation must be in [-90, 90] degrees.")
        finite_number(
            sun.get("blender_energy"), "sun.blender_energy", nonnegative=True
        )
        finite_number(
            sun.get("color_temperature_k"),
            "sun.color_temperature_k",
            positive=True,
        )
        angle = finite_number(
            sun.get("apparent_angular_diameter_deg"),
            "sun.apparent_angular_diameter_deg",
            nonnegative=True,
        )
        if angle > 180:
            raise ValueError(
                "Sun angular diameter must not exceed 180 degrees."
            )
    for light in environment.get("additional_lights", []):
        if not light.get("enabled", True):
            continue
        if light.get("type") != "SUN":
            raise ValueError("Only additional SUN lights are supported.")
        vector3(light.get("rotation_euler_rad"), "light.rotation_euler_rad")
        finite_number(
            light.get("blender_energy"),
            "light.blender_energy",
            nonnegative=True,
        )
        if "color_rgb" in light:
            vector3(light["color_rgb"], "light.color_rgb")
    for body in ("earth", "moon"):
        config = environment.get(body, {})
        if config.get("visible") or config.get("illumination", {}).get(
            "enabled"
        ):
            raise NotImplementedError(f"{body} rendering is not implemented.")
    if environment.get("stars", {}).get("visible"):
        raise NotImplementedError("Star rendering is not implemented.")

    if "trajectory" in params:
        trajectory = _mapping(params["trajectory"], "trajectory")
        if trajectory.get("type") != "linear":
            raise ValueError("Only linear trajectories are supported.")
        if trajectory.get("frame") != "world":
            raise ValueError("trajectory.frame must be 'world'.")
        if trajectory.get("object") not in {model["name"] for model in models}:
            raise ValueError("trajectory.object must name a configured model.")
        vector3(
            trajectory.get("start_position_m"), "trajectory.start_position_m"
        )
        vector3(trajectory.get("end_position_m"), "trajectory.end_position_m")
        finite_number(
            trajectory.get("max_step_m"),
            "trajectory.max_step_m",
            positive=True,
        )
    return params


def load_scene_params(params_path):
    """Read schema-v1 JSON. Invalid/missing files fail explicitly."""
    with open(params_path, encoding="utf-8") as params_file:
        return validate_scene_params(json.load(params_file))


def apply_camera_spec(params, spec_path):
    """Apply a project camera profile to both optics and render resolution."""
    result = copy.deepcopy(params)
    with open(Path(spec_path), encoding="utf-8") as spec_file:
        spec = json.load(spec_file)
    sensor = spec["sensor"]
    resolution = sensor["resolution"]
    result["scene"]["render"]["resolution_px"] = [
        resolution["width"],
        resolution["height"],
    ]
    result["camera_rig"]["name"] = spec["name"]
    for camera in result["camera_rig"]["cameras"]:
        camera["focal_length_mm"] = spec["lens"]["focalLengthMm"]
        camera["sensor_width_mm"] = sensor["activeAreaMm"]["width"]
        camera["sensor_height_mm"] = sensor["activeAreaMm"]["height"]
    return validate_scene_params(result)
