import bpy
import math
import mathutils


def create_perspective_camera(
    name,
    focal_length_mm,
    sensor_width_mm,
    sensor_height_mm,
    resolution_x,
    resolution_y,
    location=(0.0, 0.0, 0.0),
    rotation_euler=(math.pi / 2.0, 0.0, 0.0),
    clip_start=0.1,
    clip_end=2000.0,
    *,
    sensor_fit="AUTO",
    scene=None,
    collection=None,
):
    """Create a perspective camera from physical lens/sensor dimensions.

    The supplied scene (or active scene by default) render resolution is set
    to ``resolution_x`` by ``resolution_y``. Rotation values are Euler angles
    in radians.
    """
    positive_values = (
        focal_length_mm,
        sensor_width_mm,
        sensor_height_mm,
        clip_start,
        clip_end,
    )
    if not all(math.isfinite(value) for value in positive_values):
        raise ValueError("Lens, sensor, and clipping values must be finite.")
    if focal_length_mm <= 0.0:
        raise ValueError("focal_length_mm must be greater than zero.")
    if sensor_width_mm <= 0.0 or sensor_height_mm <= 0.0:
        raise ValueError("Sensor dimensions must be greater than zero.")
    if (
        isinstance(resolution_x, bool)
        or isinstance(resolution_y, bool)
        or not isinstance(resolution_x, int)
        or not isinstance(resolution_y, int)
        or resolution_x <= 0
        or resolution_y <= 0
    ):
        raise ValueError("Render resolutions must be positive integers.")
    if clip_start <= 0.0 or clip_end <= clip_start:
        raise ValueError(
            "Clipping distances must satisfy 0 < clip_start < clip_end."
        )
    if sensor_fit not in {"AUTO", "HORIZONTAL", "VERTICAL"}:
        raise ValueError(
            "sensor_fit must be 'AUTO', 'HORIZONTAL', or 'VERTICAL'."
        )

    scene = bpy.context.scene if scene is None else scene
    collection = scene.collection if collection is None else collection
    scene.render.resolution_x = resolution_x
    scene.render.resolution_y = resolution_y
    scene.render.resolution_percentage = 100

    camera_data = bpy.data.cameras.new(name=name)
    camera_data.sensor_fit = sensor_fit
    camera_data.sensor_width = sensor_width_mm
    camera_data.sensor_height = sensor_height_mm
    camera_data.lens = focal_length_mm
    camera_data.clip_start = clip_start
    camera_data.clip_end = clip_end

    camera_obj = bpy.data.objects.new(name=name, object_data=camera_data)
    camera_obj.location = location
    camera_obj.rotation_euler = rotation_euler
    collection.objects.link(camera_obj)
    return camera_obj


# K = (
#     (3200.0, 0.0, 644.0),
#     (0.0, 3200.0, 482.0),
#     (0.0, 0.0, 1.0),
# )

# # Example only: camera at the world origin, aligned to OpenCV axes.
# T_world_to_cv = (
#     (1.0, 0.0, 0.0, 0.0),
#     (0.0, 1.0, 0.0, 0.0),
#     (0.0, 0.0, 1.0, 0.0),
#     (0.0, 0.0, 0.0, 1.0),
# )

# camera = create_camera_from_KT(
#     "CalibratedCamera", K, T_world_to_cv, width=1288, height=964
# )
# bpy.context.scene.camera = camera

# Adding distortion U
# Blender's regular camera object does not use OpenCV's U coefficients
# directly. Store them as metadata if needed:
#     U = (-0.12, 0.03, 0.001, -0.002, 0.0)  # k1, k2, p1, p2, k3
# camera.data["opencv_distortion"] = list(U)


def create_camera_from_KT(
    name,
    K,
    T_world_to_cv,
    width,
    height,
    sensor_width_mm=4.83,
    *,
    scene=None,
    collection=None,
):
    """
    Create a Blender perspective camera from OpenCV intrinsics K and
    world-to-camera extrinsics T_world_to_cv.

    Supports zero-skew K with fx == fy and square render pixels.
    """
    fx, skew, cx = K[0]
    _, fy, cy = K[1]

    if abs(skew) > 1e-8:
        raise ValueError("Blender's standard camera does not support K skew.")
    if abs(fx - fy) > 1e-6:
        raise ValueError(
            "This version expects fx == fy. Non-square pixel calibration "
            "needs additional pixel-aspect handling."
        )

    scene = bpy.context.scene if scene is None else scene
    collection = scene.collection if collection is None else collection
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0

    camera_data = bpy.data.cameras.new(name)
    camera_data.sensor_fit = "HORIZONTAL"
    camera_data.sensor_width = sensor_width_mm
    camera_data.lens = fx * sensor_width_mm / width

    # Blender's shift moves the principal point relative to the image center.
    camera_data.shift_x = (width / 2.0 - cx) / width
    camera_data.shift_y = (cy - height / 2.0) / width

    camera_obj = bpy.data.objects.new(name, camera_data)
    collection.objects.link(camera_obj)

    # OpenCV camera axes: right, down, forward.
    # Blender camera axes: right, up, backward.
    T = mathutils.Matrix(T_world_to_cv)
    R_world_to_cv = T.to_3x3()
    t_world_to_cv = T.translation

    R_cv_to_world = R_world_to_cv.transposed()
    camera_position = -(R_cv_to_world @ t_world_to_cv)
    cv_to_blender_axes = mathutils.Matrix.Diagonal((1.0, -1.0, -1.0))
    R_blender_to_world = R_cv_to_world @ cv_to_blender_axes

    camera_world = R_blender_to_world.to_4x4()
    camera_world.translation = camera_position
    camera_obj.matrix_world = camera_world

    return camera_obj
