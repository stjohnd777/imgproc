"""
Accurate Space Stereo Scene Builder for SynC

Physically Grounded Enhancements:
1. Physical Sun Light (AM0 Extra-terrestrial spectrum):
   - Solar constant at 1 AU = 1361 W/m^2, normalized with scene exposure.
   - Solar angular diameter is 0.533 degrees (32 arcminutes), producing
     realistic soft shadow penumbras.
   - 5778 K blackbody color temperature.
   - Angled lighting creates realistic contrast, shadows, and specular glints.
2. No Fake Fill Light:
   - Deep space has no Rayleigh/Mie scattering; shadows receive only
     secondary bounce light.
3. Physically Based Path Tracing (Cycles Engine on Metal GPU):
   - Global illumination with indirect bounces between satellite surfaces.
   - PBR Multi-Layer Insulation (MLI gold foil) and high-gain dish reflections.
4. Deep-Space Background:
   - Pitch-black vacuum. Exposure for direct sunlight leaves stars below the
     detection threshold.
5. Calibrated Stereo Rig (Blackfly BFLY-PGE-13S2M-CS):
   - Exact sensor dimensions: 4.83mm x 3.615mm (Sony ICX445 CCD).
   - 12.0 mm rectilinear focal length.
   - 120 mm baseline along X-axis (-60 mm left, +60 mm right).
   - Sensor resolution: 1288 x 964.
   - Ground truth Z-depth map pass (OpenEXR format).
"""

import bpy
import os
import math
import mathutils
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "SynC", "pylib"))
from camera import create_perspective_camera  # noqa: E402


def build_accurate_scene():
    # 1. Clean factory reset
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # 2. Configure Cycles Path Tracer with Apple Metal GPU
    scene.render.engine = "CYCLES"
    cycles_prefs = bpy.context.preferences.addons["cycles"].preferences
    cycles_prefs.get_devices()
    metal_devices = [d for d in cycles_prefs.devices if d.type == "METAL"]
    if metal_devices:
        for d in metal_devices:
            d.use = True
        scene.cycles.device = "GPU"
        print(
            f"Enabled Metal GPU rendering: {[d.name for d in metal_devices]}"
        )
    else:
        scene.cycles.device = "CPU"
        print("Using CPU rendering")

    scene.cycles.samples = 128
    scene.cycles.preview_samples = 32
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 2

    # Blackfly camera native resolution
    scene.render.resolution_x = 1288
    scene.render.resolution_y = 964
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"

    # Use Filmic or AgX with medium-high contrast for a realistic dynamic
    # range.
    scene.view_settings.view_transform = (
        "AgX"
        if "AgX"
        in [
            v.name
            for v in scene.view_settings.bl_rna.properties[
                "view_transform"
            ].enum_items
        ]
        else "Filmic"
    )
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0

    # 3. World Shader: Deep space void (pure pitch-black)
    # Exposure calibrated for direct sunlight is too short for distant stars
    # to register, leaving a black celestial background.
    world = bpy.data.worlds.new("AccurateDeepSpace")
    scene.world = world
    world.use_nodes = True
    w_nodes = world.node_tree.nodes
    w_links = world.node_tree.links
    w_nodes.clear()

    node_out = w_nodes.new("ShaderNodeOutputWorld")
    node_bg = w_nodes.new("ShaderNodeBackground")
    node_bg.inputs["Color"].default_value = (
        0.0,
        0.0,
        0.0,
        1.0,
    )  # Pitch black space void
    node_bg.inputs["Strength"].default_value = 0.0
    w_links.new(node_bg.outputs["Background"], node_out.inputs["Surface"])

    # 4. Accurate Solar Source (AM0 Extra-terrestrial Sun)
    # Use a directional light with the Sun's angular diameter and temperature.
    sun_data = bpy.data.lights.new(name="Accurate_Sun", type="SUN")
    sun_data.energy = 5.5  # Scaled for standard AgX/Filmic exposure
    sun_data.angle = math.radians(
        0.533
    )  # 32 arcminutes true solar angular diameter

    if hasattr(sun_data, "use_temperature"):
        sun_data.use_temperature = True
        sun_data.temperature = 5778.0  # Solar surface temperature

    sun_obj = bpy.data.objects.new("Accurate_Sun", sun_data)
    # Side lighting highlights relief and casts soft, realistic shadows.
    sun_vector = mathutils.Vector((-0.65, 0.60, 0.45)).normalized()
    rot_quat = sun_vector.to_track_quat("-Z", "Y")
    sun_obj.rotation_euler = rot_quat.to_euler()
    bpy.context.collection.objects.link(sun_obj)

    # 5. Load Cassini-Huygens and position it 30 m along +Y.
    script_dir = SCRIPT_DIR
    project_root = PROJECT_ROOT
    model_path = os.path.join(
        project_root, "SynC", "models", "Cassini-Huygens (A).glb"
    )
    if not os.path.exists(model_path):
        model_path = os.path.join(
            project_root, "SynC", "models", "NEAR Shoemaker.glb"
        )

    print(f"Loading spacecraft model: {model_path}")
    bpy.ops.import_scene.gltf(filepath=model_path)

    imported_objects = [
        o for o in bpy.context.scene.objects if o.type == "MESH"
    ]
    min_c = [float("inf")] * 3
    max_c = [float("-inf")] * 3
    for obj in imported_objects:
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                min_c[i] = min(min_c[i], world_corner[i])
                max_c[i] = max(max_c[i], world_corner[i])

    center_x = (min_c[0] + max_c[0]) / 2.0
    center_y = (min_c[1] + max_c[1]) / 2.0
    center_z = (min_c[2] + max_c[2]) / 2.0
    dims = [max_c[i] - min_c[i] for i in range(3)]
    print(
        f"Spacecraft dimensions: {dims[0]:.2f}m x "
        f"{dims[1]:.2f}m x {dims[2]:.2f}m"
    )

    target_root = bpy.data.objects.new("Target_Satellite", None)
    bpy.context.collection.objects.link(target_root)
    target_root.location = (
        0.0,
        30.0,
        0.0,
    )  # Exactly 30 meters along optical line of sight
    # Realistic observation attitude
    target_root.rotation_euler = (
        math.radians(15),
        math.radians(-30),
        math.radians(20),
    )

    for obj in imported_objects:
        if obj.parent is None:
            obj.location.x -= center_x
            obj.location.y -= center_y
            obj.location.z -= center_z
            obj.parent = target_root

    # 6. Create the Blackfly BFLY-PGE-13S2M-CS stereo rig.
    baseline_m = 0.120  # 120 mm
    half_baseline = baseline_m / 2.0

    camera_options = {
        "focal_length_mm": 12.0,
        "sensor_width_mm": 4.83,
        "sensor_height_mm": 3.615,
        "resolution_x": 1288,
        "resolution_y": 964,
        "rotation_euler": (math.radians(90), 0.0, 0.0),
        "clip_end": 5000.0,
        "sensor_fit": "HORIZONTAL",
        "scene": scene,
    }
    cam_left = create_perspective_camera(
        "Blackfly_Left", location=(-half_baseline, 0.0, 0.0), **camera_options
    )
    cam_right = create_perspective_camera(
        "Blackfly_Right", location=(half_baseline, 0.0, 0.0), **camera_options
    )

    for camera in (cam_left, cam_right):
        camera.data.dof.use_dof = True
        camera.data.dof.focus_distance = 30.0
        camera.data.dof.aperture_fstop = 1.4
        camera.data.dof.aperture_blades = 6

    # 7. Enable combined RGB and Z-depth render passes for ground-truth checks.
    view_layer = scene.view_layers[0]
    view_layer.use_pass_z = True

    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()

    rl_node = tree.nodes.new("CompositorNodeRLayers")
    comp_node = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(rl_node.outputs["Image"], comp_node.inputs["Image"])

    # File Output node for OpenEXR 32-bit Depth ground truth
    out_dir = script_dir
    os.makedirs(out_dir, exist_ok=True)

    file_out = tree.nodes.new("CompositorNodeOutputFile")
    file_out.format.file_format = "OPEN_EXR"
    file_out.format.color_depth = "32"
    file_out.base_path = out_dir
    file_out.file_slots[0].path = "ground_truth_depth_left"
    tree.links.new(rl_node.outputs["Depth"], file_out.inputs[0])

    # 8. Save Blend File
    blend_path = os.path.join(out_dir, "accurate_space_stereo.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved accurate scene blend file to: {blend_path}")

    # 9. Render Left view (with Depth map)
    scene.camera = cam_left
    left_img_path = os.path.join(out_dir, "accurate_left.png")
    scene.render.filepath = left_img_path
    print("Rendering Left view with Cycles Path Tracer...")
    bpy.ops.render.render(write_still=True)
    print(f"Saved Left Image: {left_img_path}")

    # Rename depth map generated by compositor
    depth_left_raw = os.path.join(out_dir, "ground_truth_depth_left0001.exr")
    depth_left_dest = os.path.join(out_dir, "accurate_depth_left.exr")
    if os.path.exists(depth_left_raw):
        if os.path.exists(depth_left_dest):
            os.remove(depth_left_dest)
        os.rename(depth_left_raw, depth_left_dest)
        print(f"Saved Ground Truth Depth (EXR): {depth_left_dest}")

    # 10. Render Right view
    scene.camera = cam_right
    file_out.file_slots[0].path = "ground_truth_depth_right"
    right_img_path = os.path.join(out_dir, "accurate_right.png")
    scene.render.filepath = right_img_path
    print("Rendering Right view with Cycles Path Tracer...")
    bpy.ops.render.render(write_still=True)
    print(f"Saved Right Image: {right_img_path}")

    depth_right_raw = os.path.join(out_dir, "ground_truth_depth_right0001.exr")
    depth_right_dest = os.path.join(out_dir, "accurate_depth_right.exr")
    if os.path.exists(depth_right_raw):
        if os.path.exists(depth_right_dest):
            os.remove(depth_right_dest)
        os.rename(depth_right_raw, depth_right_dest)
        print(f"Saved Ground Truth Right Depth (EXR): {depth_right_dest}")

    print("Accurate space stereo rendering complete!")


if __name__ == "__main__":
    build_accurate_scene()
