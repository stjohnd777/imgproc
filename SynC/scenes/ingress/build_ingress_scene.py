"""
Dynamic Ingress Simulation Scene Builder for SynC

Reads parameters from params.json (or CLI flags) to render a stereo ingress sequence.
Features:
- Parameterized target model, approach distance (start/stop/increment), and sun angle (azimuth/elevation).
- Camera rig configurable directly or via camera_spec/ JSON (e.g. Blackfly narrow vs See3CAM wide).
- Trajectory logger recording ground truth distance, coordinates, and theoretical disparity for every frame.
- Structured output under left/ and right/ folders.
"""

import bpy
import os
import sys
import math
import json
import argparse
import mathutils

def load_camera_spec(spec_rel_path, project_root):
    spec_abs = os.path.join(project_root, spec_rel_path)
    if not os.path.exists(spec_abs):
        return None
    try:
        with open(spec_abs, "r") as f:
            data = json.load(f)
        res = data.get("sensor", {}).get("resolution", {"width": 1288, "height": 964})
        active_area = data.get("sensor", {}).get("activeAreaMm", {"width": 4.83, "height": 3.615})
        lens_fl = data.get("lens", {}).get("focalLengthMm", 12.0)
        return {
            "name": data.get("name", "Unknown"),
            "resolution": res,
            "sensor_size_mm": active_area,
            "lens_focal_length_mm": lens_fl
        }
    except Exception as e:
        print(f"Warning: could not load camera spec {spec_abs}: {e}")
        return None

def sun_vector_from_angles(azimuth_deg, elevation_deg):
    """
    Computes unit sun illumination vector from azimuth (deg from +Y toward +X)
    and elevation (deg above XY plane).
    The vector points from the Sun toward the scene.
    """
    az_rad = math.radians(azimuth_deg)
    el_rad = math.radians(elevation_deg)
    sun_x = math.sin(az_rad) * math.cos(el_rad)
    sun_y = math.cos(az_rad) * math.cos(el_rad)
    sun_z = math.sin(el_rad)
    return mathutils.Vector((-sun_x, -sun_y, -sun_z)).normalized()

def setup_ingress_scene(params, project_root, script_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # 1. Render engine and image format
    render_cfg = params.get("render", {})
    engine_pref = render_cfg.get("engine", "BLENDER_EEVEE_NEXT")
    available_engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    if engine_pref not in available_engines:
        engine_pref = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in available_engines else 'CYCLES'
    scene.render.engine = engine_pref

    cam_cfg = params.get("camera", {})
    res_w = cam_cfg.get("resolution", {}).get("width", 1288)
    res_h = cam_cfg.get("resolution", {}).get("height", 964)
    scene.render.resolution_x = res_w
    scene.render.resolution_y = res_h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = render_cfg.get("color_mode", "RGB")

    # Pure space black background
    world = bpy.data.worlds.new("SpaceWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
        bg_node.inputs['Strength'].default_value = 0.0

    # 2. Solar light (AM0 Sun) with parameterized angle and spectrum
    sun_cfg = params.get("sun", {})
    sun_data = bpy.data.lights.new(name="Sun_Light", type='SUN')
    sun_data.energy = float(sun_cfg.get("energy", 5.0))
    sun_angle_deg = float(sun_cfg.get("apparent_diameter_deg", 0.533))
    sun_data.angle = math.radians(sun_angle_deg)
    if hasattr(sun_data, "use_temperature"):
        sun_data.use_temperature = True
        sun_data.temperature = float(sun_cfg.get("temperature_k", 5778.0))

    sun_obj = bpy.data.objects.new("Sun_Light", sun_data)
    az_deg = float(sun_cfg.get("azimuth_deg", 180.0))
    el_deg = float(sun_cfg.get("elevation_deg", 30.0))
    sun_ray_dir = sun_vector_from_angles(az_deg, el_deg)
    sun_obj.rotation_euler = sun_ray_dir.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(sun_obj)
    print(f"Sun configured: Azimuth {az_deg} deg, Elevation {el_deg} deg, AngDiam {sun_angle_deg} deg")

    # 3. Load Target Satellite Model
    target_model_name = params.get("target_model", "Cassini-Huygens (A).glb")
    model_path = os.path.join(project_root, "SynC", "models", target_model_name)
    if not os.path.exists(model_path):
        fallback = os.path.join(project_root, "SynC", "models", "Cassini-Huygens (A).glb")
        if os.path.exists(fallback):
            model_path = fallback
        else:
            model_path = os.path.join(project_root, "SynC", "models", "NEAR Shoemaker.glb")

    print(f"Loading spacecraft model: {model_path}")
    bpy.ops.import_scene.gltf(filepath=model_path)

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
    print(f"Spacecraft dimensions: {dims[0]:.2f}m x {dims[1]:.2f}m x {dims[2]:.2f}m")

    target_root = bpy.data.objects.new("Target_Satellite", None)
    bpy.context.collection.objects.link(target_root)
    start_distance = float(params.get("start", 100.0))
    target_root.location = (0.0, start_distance, 0.0)
    target_root.rotation_euler = (math.radians(15), math.radians(-30), math.radians(20))

    for obj in imported_objects:
        if obj.parent is None:
            obj.location.x -= center_x
            obj.location.y -= center_y
            obj.location.z -= center_z
            obj.parent = target_root

    # 4. Calibrated Stereo Rig
    baseline_mm = float(cam_cfg.get("baseline_mm", 120.0))
    baseline_m = baseline_mm / 1000.0
    half_baseline = baseline_m / 2.0
    sensor_w = float(cam_cfg.get("sensor_size_mm", {}).get("width", 4.83))
    sensor_h = float(cam_cfg.get("sensor_size_mm", {}).get("height", 3.615))
    focal_len = float(cam_cfg.get("lens_focal_length_mm", 12.0))

    def make_camera(name, x_offset):
        c_data = bpy.data.cameras.new(name=name)
        c_data.sensor_fit = 'HORIZONTAL'
        c_data.sensor_width = sensor_w
        c_data.sensor_height = sensor_h
        c_data.lens = focal_len
        c_data.clip_start = 0.1
        c_data.clip_end = 10000.0

        c_obj = bpy.data.objects.new(name=name, object_data=c_data)
        c_obj.location = (x_offset, 0.0, 0.0)
        c_obj.rotation_euler = (math.radians(90), 0.0, 0.0)
        bpy.context.collection.objects.link(c_obj)
        return c_obj

    cam_left = make_camera("Camera_Left", -half_baseline)
    cam_right = make_camera("Camera_Right", half_baseline)

    return scene, target_root, cam_left, cam_right

def run_ingress(params_override=None, dry_run=False):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))

    # Load defaults from params.json if present
    params_path = os.path.join(script_dir, "params.json")
    params = {}
    if os.path.exists(params_path):
        try:
            with open(params_path, "r") as f:
                params = json.load(f)
            print(f"Loaded configuration from: {params_path}")
        except Exception as e:
            print(f"Warning: could not parse {params_path}: {e}")

    # Check if a camera spec was referenced
    cam_spec_ref = params.get("camera", {}).get("spec")
    if cam_spec_ref:
        loaded_spec = load_camera_spec(cam_spec_ref, project_root)
        if loaded_spec:
            params.setdefault("camera", {})
            for k, v in loaded_spec.items():
                if k not in params["camera"] or params["camera"][k] is None:
                    params["camera"][k] = v

    # Apply any programmatic overrides
    if params_override:
        for k, v in params_override.items():
            if v is not None:
                if isinstance(v, dict) and isinstance(params.get(k), dict):
                    params[k].update(v)
                else:
                    params[k] = v

    start_m = float(params.get("start", 100.0))
    stop_m = float(params.get("stop", 10.0))
    increment_m = float(params.get("increment", 0.5))

    left_dir = os.path.join(script_dir, "left")
    right_dir = os.path.join(script_dir, "right")
    os.makedirs(left_dir, exist_ok=True)
    os.makedirs(right_dir, exist_ok=True)

    scene, target, cam_left, cam_right = setup_ingress_scene(params, project_root, script_dir)

    blend_path = os.path.join(script_dir, "ingress_stereo.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print(f"Saved ingress blend file to: {blend_path}")

    # Calculate distance steps
    distances = []
    d = start_m
    while d >= stop_m - 1e-5:
        distances.append(round(d, 3))
        d -= increment_m

    total_frames = len(distances)
    print(f"Ingress Trajectory: {start_m:.1f}m -> {stop_m:.1f}m (step {increment_m:.2f}m) = {total_frames} frames ({total_frames*2} images)")

    cam_cfg = params.get("camera", {})
    res_w = cam_cfg.get("resolution", {}).get("width", 1288)
    res_h = cam_cfg.get("resolution", {}).get("height", 964)
    sensor_w_mm = cam_cfg.get("sensor_size_mm", {}).get("width", 4.83)
    focal_len_mm = cam_cfg.get("lens_focal_length_mm", 12.0)
    baseline_mm = cam_cfg.get("baseline_mm", 120.0)

    # Theoretical focal length in pixels: fx = (f_mm / sensor_width_mm) * resolution_w
    fx_px = (focal_len_mm / sensor_w_mm) * res_w

    trajectory_log = {
        "metadata": {
            "name": params.get("name", "ingress"),
            "targetModel": params.get("target_model", "Cassini-Huygens (A).glb"),
            "sun": params.get("sun", {}),
            "camera": {
                "name": cam_cfg.get("name", "Blackfly BFLY-PGE-13S2M-CS"),
                "resolution": {"width": res_w, "height": res_h},
                "focalLengthMm": focal_len_mm,
                "sensorWidthMm": sensor_w_mm,
                "fx_pixels": round(fx_px, 2),
                "baselineMm": baseline_mm
            },
            "trajectory": {
                "startDistanceMeters": start_m,
                "endDistanceMeters": stop_m,
                "stepMeters": increment_m,
                "totalFrames": total_frames
            }
        },
        "frames": []
    }

    for idx, dist in enumerate(distances):
        frame_num = idx + 1
        frame_str = f"{frame_num:04d}"

        target.location.y = dist

        dist_mm = dist * 1000.0
        theoretical_disparity = (fx_px * baseline_mm) / dist_mm

        left_filename = f"frame_{frame_str}.png"
        right_filename = f"frame_{frame_str}.png"
        left_path = os.path.join(left_dir, left_filename)
        right_path = os.path.join(right_dir, right_filename)

        trajectory_log["frames"].append({
            "frame": frame_num,
            "distanceMeters": dist,
            "theoreticalCenterDisparityPx": round(theoretical_disparity, 3),
            "leftImage": f"left/{left_filename}",
            "rightImage": f"right/{right_filename}"
        })

        if dry_run:
            continue

        scene.camera = cam_left
        scene.render.filepath = left_path
        bpy.ops.render.render(write_still=True)

        scene.camera = cam_right
        scene.render.filepath = right_path
        bpy.ops.render.render(write_still=True)

        if frame_num % 10 == 0 or frame_num == 1 or frame_num == total_frames:
            print(f"[{frame_num}/{total_frames}] Distance {dist:.1f}m -> disparity ~{theoretical_disparity:.2f}px")

    traj_path = os.path.join(script_dir, "ground_truth_trajectory.json")
    with open(traj_path, "w") as f:
        json.dump(trajectory_log, f, indent=2)
    print(f"Saved trajectory log to: {traj_path}")
    print("Sequence generation complete!")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Render stereo ingress trajectory driven by params.json")
    parser.add_argument("--params", type=str, default="params.json", help="Path to parameters JSON file")
    parser.add_argument("--start", type=float, default=None, help="Override start distance in meters")
    parser.add_argument("--stop", type=float, default=None, help="Override stop distance in meters")
    parser.add_argument("--increment", type=float, default=None, help="Override step distance in meters")
    parser.add_argument("--target-model", type=str, default=None, help="Override target model filename")
    parser.add_argument("--azimuth", type=float, default=None, help="Override sun azimuth in degrees")
    parser.add_argument("--elevation", type=float, default=None, help="Override sun elevation in degrees")
    parser.add_argument("--dry-run", action="store_true", help="Generate blend file and ground truth log without rendering")

    args_to_parse = []
    if "--" in sys.argv:
        args_to_parse = sys.argv[sys.argv.index("--") + 1:]

    args = parser.parse_args(args_to_parse)

    overrides = {}
    if args.start is not None: overrides["start"] = args.start
    if args.stop is not None: overrides["stop"] = args.stop
    if args.increment is not None: overrides["increment"] = args.increment
    if args.target_model is not None: overrides["target_model"] = args.target_model
    if args.azimuth is not None:
        overrides.setdefault("sun", {})["azimuth_deg"] = args.azimuth
    if args.elevation is not None:
        overrides.setdefault("sun", {})["elevation_deg"] = args.elevation

    run_ingress(params_override=overrides if overrides else None, dry_run=args.dry_run)
