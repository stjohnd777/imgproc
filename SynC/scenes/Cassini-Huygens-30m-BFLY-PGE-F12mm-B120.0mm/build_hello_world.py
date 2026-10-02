import bpy
import os
import math
import mathutils

def build_scene():
    # 1. Reset to clean empty scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # 2. Configure render engine (EEVEE for fast rasterization, or CYCLES for full path tracing)
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderSettings') and 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    
    # Render resolution matching Blackfly BFLY-PGE-13S2M-CS (1288 x 964)
    scene.render.resolution_x = 1288
    scene.render.resolution_y = 964
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'

    # Black space background
    world = bpy.data.worlds.new("SpaceWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs['Color'].default_value = (0.002, 0.002, 0.005, 1.0) # Deep dark space
        bg_node.inputs['Strength'].default_value = 1.0

    # 3. Import Target Model (e.g. Cassini-Huygens) and place at 30m distance
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    model_path = os.path.join(project_root, "SynC", "models", "Cassini-Huygens (A).glb")
    if not os.path.exists(model_path):
        model_path = os.path.join(project_root, "SynC", "models", "NEAR Shoemaker.glb")
    
    print(f"Importing model from: {model_path}")
    bpy.ops.import_scene.gltf(filepath=model_path)

    # Calculate model center and size
    imported_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    min_c = [float('inf')] * 3
    max_c = [float('-inf')] * 3
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
    print(f"Original model dimensions: {dims[0]:.2f}m x {dims[1]:.2f}m x {dims[2]:.2f}m")

    # Group under a root empty and place at (0, 30.0, 0)
    target_root = bpy.data.objects.new("Target_Satellite", None)
    bpy.context.collection.objects.link(target_root)
    target_root.location = (0.0, 30.0, 0.0)
    # Slight tilt so solar panels, dish, and instruments are visible
    target_root.rotation_euler = (math.radians(20), math.radians(-35), math.radians(15))

    for obj in imported_objects:
        if obj.parent is None:
            # Shift object so model center is at root
            obj.location.x -= center_x
            obj.location.y -= center_y
            obj.location.z -= center_z
            obj.parent = target_root

    # 4. Sun light placed behind the camera shining forward toward the target
    # Cameras are at origin looking along +Y, so light is at negative Y (behind cameras)
    sun_data = bpy.data.lights.new(name="Sun_Light", type='SUN')
    sun_data.energy = 4.5
    sun_data.angle = math.radians(0.533) # Real solar angular size
    sun_obj = bpy.data.objects.new("Sun_Light", sun_data)
    sun_obj.location = (-2.0, -10.0, 5.0)
    # Direction toward target at (0, 30, 0)
    direction = mathutils.Vector((0.0, 30.0, 0.0)) - mathutils.Vector((-2.0, -10.0, 5.0))
    rot_quat = direction.to_track_quat('-Z', 'Y')
    sun_obj.rotation_euler = rot_quat.to_euler()
    bpy.context.collection.objects.link(sun_obj)

    # Subtle fill light from Earth/space
    fill_data = bpy.data.lights.new(name="Fill_Light", type='SUN')
    fill_data.energy = 0.4
    fill_data.color = (0.6, 0.75, 1.0)
    fill_obj = bpy.data.objects.new("Fill_Light", fill_data)
    fill_obj.rotation_euler = (math.radians(60), math.radians(-120), 0)
    bpy.context.collection.objects.link(fill_obj)

    # 5. Define Stereo Camera Rig based on Blackfly BFLY-PGE-13S2M-CS:
    # Sensor: Sony ICX445, 4.83mm x 3.615mm, 12mm focal length
    # Baseline: 120 mm (0.12 m) along X-axis
    baseline_m = 0.120
    half_baseline = baseline_m / 2.0

    def create_blackfly_camera(name, x_offset):
        cam_data = bpy.data.cameras.new(name=name)
        cam_data.sensor_fit = 'HORIZONTAL'
        cam_data.sensor_width = 4.83      # width in mm
        cam_data.sensor_height = 3.615    # height in mm
        cam_data.lens = 12.0              # focal length in mm
        cam_data.clip_start = 0.1
        cam_data.clip_end = 2000.0

        cam_obj = bpy.data.objects.new(name=name, object_data=cam_data)
        cam_obj.location = (x_offset, 0.0, 0.0)
        # Blender cameras default look along local -Z.
        # To look forward along global +Y with +Z up: rotate 90 deg around X.
        cam_obj.rotation_euler = (math.radians(90), 0.0, 0.0)
        bpy.context.collection.objects.link(cam_obj)
        return cam_obj

    cam_left = create_blackfly_camera("Blackfly_Left", -half_baseline)
    cam_right = create_blackfly_camera("Blackfly_Right", half_baseline)

    # 6. Save Blender project file
    scenes_dir = script_dir
    os.makedirs(scenes_dir, exist_ok=True)
    blend_path = os.path.join(scenes_dir, "hello_world_stereo.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved Blender scene to: {blend_path}")

    # 7. Render Left Camera
    scene.camera = cam_left
    left_render_path = os.path.join(scenes_dir, "hello_world_left.png")
    scene.render.filepath = left_render_path
    print("Rendering Left view...")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Left image: {left_render_path}")

    # 8. Render Right Camera
    scene.camera = cam_right
    right_render_path = os.path.join(scenes_dir, "hello_world_right.png")
    scene.render.filepath = right_render_path
    print("Rendering Right view...")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered Right image: {right_render_path}")

if __name__ == "__main__":
    build_scene()
