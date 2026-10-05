"""Shared Blender setup for static and trajectory-based SynC scene drivers."""

import math
from pathlib import Path

import bpy
from mathutils import Vector

from camera import create_perspective_camera
from scene_config import validate_scene_params


def configure_render(scene, render_params):
    engines = {
        item.identifier
        for item in bpy.types.RenderSettings.bl_rna.properties[
            "engine"
        ].enum_items
    }
    engine = render_params["engine"]
    if engine not in engines:
        alias = {
            "BLENDER_EEVEE_NEXT": "BLENDER_EEVEE",
            "BLENDER_EEVEE": "BLENDER_EEVEE_NEXT",
        }.get(engine)
        if alias not in engines:
            raise ValueError(f"Render engine {engine!r} is not available.")
        print(
            f"Using {alias!r} instead of {engine!r} for this Blender version."
        )
        engine = alias
    scene.render.engine = engine
    scene.render.resolution_x, scene.render.resolution_y = render_params[
        "resolution_px"
    ]
    scene.render.resolution_percentage = render_params.get(
        "resolution_percentage", 100
    )
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    scene.render.image_settings.file_format = render_params["image_format"]
    scene.render.image_settings.color_mode = render_params["color_mode"]
    if "color_depth" in render_params:
        scene.render.image_settings.color_depth = render_params["color_depth"]
    if "samples" in render_params:
        samples = render_params["samples"]
        if engine == "CYCLES":
            scene.cycles.samples = samples
        elif hasattr(scene, "eevee") and hasattr(
            scene.eevee, "taa_render_samples"
        ):
            scene.eevee.taa_render_samples = samples
        else:
            raise ValueError("This Blender version cannot set EEVEE samples.")


def configure_environment(scene, environment):
    world = bpy.data.worlds.new("SpaceWorld")
    world.use_nodes = True
    scene.world = world
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (
        *environment["background"]["color_rgb"],
        1.0,
    )
    background.inputs["Strength"].default_value = environment["background"][
        "strength"
    ]
    sun = environment["sun"]
    if sun.get("enabled", False):
        direction = sun["direction"]
        azimuth = math.radians(direction["azimuth_deg"])
        elevation = math.radians(direction["elevation_deg"])
        scene_to_sun = Vector(
            (
                math.sin(azimuth) * math.cos(elevation),
                math.cos(azimuth) * math.cos(elevation),
                math.sin(elevation),
            )
        )
        light = bpy.data.lights.new("Sun_Light", "SUN")
        light.energy = sun["blender_energy"]
        light.angle = math.radians(sun["apparent_angular_diameter_deg"])
        if hasattr(light, "use_temperature"):
            light.use_temperature = True
            light.temperature = sun["color_temperature_k"]
        else:
            print(
                "Sun color temperature is unsupported by this Blender "
                "version; retaining the default white Sun."
            )
        obj = bpy.data.objects.new("Sun_Light", light)
        obj.rotation_euler = (
            (-scene_to_sun).to_track_quat("-Z", "Y").to_euler()
        )
        scene.collection.objects.link(obj)
    for config in environment.get("additional_lights", []):
        if not config.get("enabled", True):
            continue
        light = bpy.data.lights.new(config["name"], config["type"])
        light.energy = config["blender_energy"]
        light.color = config.get("color_rgb", (1.0, 1.0, 1.0))
        obj = bpy.data.objects.new(config["name"], light)
        obj.rotation_euler = config["rotation_euler_rad"]
        scene.collection.objects.link(obj)


def import_models(scene, configs, models_dir):
    """Recenter each asset under a named world-pose root, keeping hierarchy."""
    models = {}
    for config in configs:
        model_path = Path(models_dir) / config["file"]
        if not model_path.is_file():
            raise FileNotFoundError(f"Model file not found: {model_path}")
        existing = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(model_path))
        imported = set(bpy.data.objects) - existing
        meshes = [obj for obj in imported if obj.type == "MESH"]
        if not meshes:
            raise ValueError(f"No mesh objects imported from {model_path}")
        scene.view_layers[0].update()
        corners = [
            obj.matrix_world @ Vector(corner)
            for obj in meshes
            for corner in obj.bound_box
        ]
        center = Vector(
            [
                (min(p[axis] for p in corners) + max(p[axis] for p in corners))
                / 2
                for axis in range(3)
            ]
        )
        root = bpy.data.objects.new(config["name"], None)
        scene.collection.objects.link(root)
        for obj in imported:
            if obj.parent not in imported:
                transform = obj.matrix_world.copy()
                transform.translation -= center
                obj.parent = root
                obj.matrix_world = transform
        pose = config["pose"]
        root.location = pose["translation_m"]
        root.rotation_mode = pose.get("rotation_order", "XYZ")
        root.rotation_euler = pose["rotation_euler_rad"]
        models[config["name"]] = root
    return models


def create_cameras(scene, rig):
    percentage = scene.render.resolution_percentage
    cameras = []
    for config in rig["cameras"]:
        pose = config["pose"]
        camera = create_perspective_camera(
            name=config["name"],
            focal_length_mm=config["focal_length_mm"],
            sensor_width_mm=config["sensor_width_mm"],
            sensor_height_mm=config["sensor_height_mm"],
            resolution_x=scene.render.resolution_x,
            resolution_y=scene.render.resolution_y,
            location=pose["translation_m"],
            rotation_euler=pose["rotation_euler_rad"],
            sensor_fit=config["sensor_fit"],
            clip_start=config.get("clip_start_m", 0.1),
            clip_end=config.get("clip_end_m", 2000.0),
            scene=scene,
        )
        camera.rotation_mode = pose.get("rotation_order", "XYZ")
        camera.rotation_euler = pose["rotation_euler_rad"]
        cameras.append(camera)
    # The physical-camera factory sets render percentage to 100.
    scene.render.resolution_percentage = percentage
    return cameras


def build_scene(params, models_dir):
    """Return the configured scene, ordered cameras, and model-root mapping."""
    validate_scene_params(params)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = params["scene"]["name"]
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    configure_render(scene, params["scene"]["render"])
    configure_environment(scene, params["environment"])
    models = import_models(scene, params["models"], models_dir)
    cameras = create_cameras(scene, params["camera_rig"])
    scene.camera = cameras[0]
    scene.view_layers[0].update()
    return scene, cameras, models


def render_camera(scene, camera, path_without_extension):
    scene.camera = camera
    path = str(path_without_extension) + scene.render.file_extension
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
