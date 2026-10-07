"""Verify the diagonal scene with Blender's real projection and render output."""

import copy
from pathlib import Path
import sys
import tempfile
import unittest

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "SynC" / "pylib"))
from ingress_egress import move_object_along_path
from render_scene import render_scene, trajectory_path
from scene_config import load_scene_params
from scene_setup import render_camera


class LinearMotionTests(unittest.TestCase):
    def test_corner_crossing_fixed_camera_and_rendered_visibility(self):
        params = load_scene_params(
            ROOT / "SynC" / "scenes" / "linear_motion" / "params.json"
        )
        preview = copy.deepcopy(params)
        preview["scene"]["render"].update(resolution_percentage=25, samples=1)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            log = render_scene(preview, output, dry_run=True)
            self.assertEqual(len(log["frames"]), 131)
            self.assertFalse(log["metadata"]["disparity_available"])
            scene = bpy.context.scene
            camera = bpy.data.objects["BlkFly"]
            target = bpy.data.objects["cassini"]
            path = trajectory_path(params["trajectory"])
            projections = []
            for index, frame in enumerate(log["frames"]):
                self.assertEqual(frame["images"], {
                    "BlkFly": f"frames/frame_{index + 1:04d}.png"
                })
                self.assertEqual(frame["cameraToWorld"], log["frames"][0]["cameraToWorld"])
                position = Vector(frame["positionWorldMeters"])
                self.assertAlmostEqual(position.y, 100)
                self.assertLessEqual(frame["stepMeters"], 0.5)
                projection = world_to_camera_view(scene, camera, position)
                self.assertGreater(projection.z, 0)
                self.assertAlmostEqual(projection.x + projection.y, 1, places=5)
                projections.append(projection)
            self.assertLess(projections[0].x, 0)
            self.assertGreater(projections[0].y, 1)
            self.assertGreater(projections[-1].x, 1)
            self.assertLess(projections[-1].y, 0)
            self.assertAlmostEqual(projections[65].x, 0.5, places=5)
            self.assertAlmostEqual(projections[65].y, 0.5, places=5)
            for previous, current in zip(projections, projections[1:]):
                self.assertGreater(current.x, previous.x)
                self.assertLess(current.y, previous.y)
            centroids = []
            for index, t in enumerate((0, 0.25, 0.5, 0.75, 1)):
                move_object_along_path(target, path, t)
                scene.view_layers[0].update()
                filename = render_camera(scene, camera, output / f"preview_{index}")
                image = bpy.data.images.load(filename, check_existing=False)
                try:
                    self.assertEqual(tuple(image.size), (322, 241))
                    pixels = list(image.pixels)
                    visible = [
                        pixel for pixel in range(322 * 241)
                        if max(pixels[pixel * 4:pixel * 4 + 3]) > 0.01
                    ]
                    if t in (0, 1):
                        self.assertEqual(len(visible), 0, "Endpoint must be empty background")
                    else:
                        self.assertGreater(len(visible), 50)
                        centroids.append((
                            sum(pixel % 322 for pixel in visible) / len(visible),
                            sum(pixel // 322 for pixel in visible) / len(visible),
                        ))
                finally:
                    bpy.data.images.remove(image)
            for previous, current in zip(centroids, centroids[1:]):
                self.assertGreater(current[0], previous[0])
                self.assertLess(current[1], previous[1])


if __name__ == "__main__":
    unittest.main(argv=[__file__])
