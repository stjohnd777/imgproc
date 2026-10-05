import mathutils


# example
# import mathutils
# from camera_look_at import camera_look_at

# target_transform = mathutils.Matrix.Translation((0.0, 30.0, 0.0))
# camera_look_at(camera, target_transform)


def camera_look_at(camera, target_matrix):
    """Orient a Blender camera toward the world position in a 4x4 transform.

    The target position is read from ``target_matrix.translation``. The camera
    retains its world-space position and scale, and its local -Z axis points
    toward the target with local Y as the up axis.
    """

    if camera.type != "CAMERA":
        raise TypeError("camera must be a Blender camera object.")

    target_transform = mathutils.Matrix(target_matrix)

    if len(target_transform) != 4 or any(
        len(row) != 4 for row in target_transform
    ):
        raise ValueError("target_matrix must be a 4x4 world transform.")

    camera_world = camera.matrix_world.copy()
    camera_position, _, camera_scale = camera_world.decompose()

    # The vector points from the camera to the target.
    direction = target_transform.translation - camera_position

    if direction.length == 0.0:
        raise ValueError("Camera and target positions must be different.")

    # Track local -Z toward the target and keep local Y as the up direction.
    camera_rotation = direction.to_track_quat("-Z", "Y")

    camera_world = (
        camera_rotation.to_matrix().to_4x4()
        @ mathutils.Matrix.Diagonal(
            (camera_scale.x, camera_scale.y, camera_scale.z, 1.0)
        )
    )
    camera_world.translation = camera_position
    camera.matrix_world = camera_world
    return camera
