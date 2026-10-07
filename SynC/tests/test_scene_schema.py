"""Schema tests plus Blender integration checks (run with Blender --python)."""

import copy
import importlib.util
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "SynC" / "pylib"))
from scene_config import (  # noqa: E402
    apply_camera_spec,
    load_scene_params,
    validate_scene_params,
)

INGRESS = ROOT / "SynC" / "scenes" / "ingress"
STATIC = (
    ROOT / "SynC" / "scenes" / ("Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm")
)
HAS_BLENDER = importlib.util.find_spec("bpy") is not None


def load_driver(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.params = load_scene_params(INGRESS / "params.json")

    def test_both_defaults_use_shared_schema(self):
        for folder in (STATIC, INGRESS):
            params = load_scene_params(folder / "params.json")
            self.assertEqual(params["schema_version"], 1)
            self.assertEqual(params["camera_rig"]["baseline_m"], 0.12)
        self.assertNotIn(
            "trajectory", load_scene_params(STATIC / "params.json")
        )
        motion = self.params["trajectory"]
        distance = math.dist(
            motion["start_position_m"], motion["end_position_m"]
        )
        self.assertEqual(math.ceil(distance / motion["max_step_m"]) + 1, 181)

    def test_rejects_invalid_schema_and_geometry(self):
        mutations = (
            lambda p: p.update(schema_version=2),
            lambda p: p.update(schema_version=True),
            lambda p: p["trajectory"].update(type="unsupported"),
            lambda p: p["trajectory"].update(object="missing"),
            lambda p: p["trajectory"].update(max_step_m=0),
            lambda p: p["trajectory"].update(max_step_m=float("nan")),
            lambda p: p["trajectory"].update(start_position_m=[0, 1]),
            lambda p: p["camera_rig"].update(baseline_m=1),
            lambda p: p["scene"]["render"].update(resolution_px=[True, 2]),
            lambda p: p["models"][0]["pose"].update(frame="camera"),
            lambda p: p["environment"]["sun"]["direction"].update(
                frame="body"
            ),
        )
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                params = copy.deepcopy(self.params)
                mutate(params)
                with self.assertRaises(ValueError):
                    validate_scene_params(params)

    def test_missing_and_malformed_json_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "params.json"
            with self.assertRaises(FileNotFoundError):
                load_scene_params(path)
            path.write_text("{", encoding="utf-8")
            with self.assertRaises(json.JSONDecodeError):
                load_scene_params(path)

    def test_piecewise_schema_and_output_validation(self):
        params = self.params
        params["trajectory"] = {
            "type": "piecewise_linear",
            "object": "cassini",
            "frame": "world",
            "waypoints_m": [[0, 100, 0], [1, 100, 0], [1, 99, 0]],
            "max_step_m": 0.5,
        }
        params["output"] = {"prefix": "orbit-approximation"}
        validate_scene_params(params)
        for points in ([], [[0, 1, 0]], [[0, 1, 0], [0, float("inf"), 0]]):
            invalid = copy.deepcopy(params)
            invalid["trajectory"]["waypoints_m"] = points
            with self.assertRaises(ValueError):
                validate_scene_params(invalid)
        params["output"]["prefix"] = "../escape"
        with self.assertRaises(ValueError):
            validate_scene_params(params)

    def test_orbit_schema_defaults_and_invalid_inputs(self):
        params = self.params
        params["trajectory"] = {
            "type": "orbit",
            "target": "cassini",
            "frame": "world",
            "max_step_m": 1,
        }
        validate_scene_params(params)
        mutations = (
            {"target": "missing"},
            {"radius_m": 0},
            {"axis_world": [0, 0, 0]},
            {"axis_world": [0, 0]},
            {"track_target": 1},
            {"track_target": "false"},
            {"sweep_angle_deg": float("nan")},
            {"start_angle_deg": float("inf")},
            {"object": "cassini"},
        )
        for values in mutations:
            with self.subTest(values=values):
                invalid = copy.deepcopy(params)
                invalid["trajectory"].update(values)
                with self.assertRaises(ValueError):
                    validate_scene_params(invalid)

    def test_camera_profile_updates_optics_and_resolution(self):
        params = apply_camera_spec(
            self.params, ROOT / "camera_spec" / "bfly_pge_13s2m_cs.json"
        )
        self.assertEqual(
            params["scene"]["render"]["resolution_px"], [1288, 964]
        )
        for camera in params["camera_rig"]["cameras"]:
            self.assertEqual(camera["focal_length_mm"], 12)
            self.assertEqual(camera["sensor_width_mm"], 4.83)
        with self.assertRaises(FileNotFoundError):
            apply_camera_spec(self.params, ROOT / "missing-profile.json")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "camera.json"
            path.write_text(
                json.dumps(
                    {
                        "name": "Test optics",
                        "sensor": {
                            "resolution": {"width": 640, "height": 480},
                            "activeAreaMm": {"width": 6.4, "height": 4.8},
                        },
                        "lens": {"focalLengthMm": 8},
                    }
                ),
                encoding="utf-8",
            )
            params = apply_camera_spec(self.params, path)
            self.assertEqual(
                params["scene"]["render"]["resolution_px"], [640, 480]
            )
            for camera in params["camera_rig"]["cameras"]:
                self.assertEqual(camera["focal_length_mm"], 8)
                self.assertEqual(camera["sensor_width_mm"], 6.4)
            self.assertEqual(
                self.params["scene"]["render"]["resolution_px"], [1288, 964]
            )


@unittest.skipUnless(HAS_BLENDER, "Blender bpy is required")
class BlenderSceneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ingress = load_driver(
            INGRESS / "build_ingress_scene.py", "ingress_driver"
        )
        cls.static = load_driver(
            STATIC / "cassini-stereo-pair.py", "static_driver"
        )

    def setUp(self):
        self.params = load_scene_params(INGRESS / "params.json")

    def test_static_and_ingress_share_setup(self):
        from scene_setup import build_scene

        for folder in (STATIC, INGRESS):
            params = load_scene_params(folder / "params.json")
            params["scene"]["render"]["resolution_percentage"] = 50
            scene, cameras, models = build_scene(
                params, ROOT / "SynC" / "models"
            )
            self.assertEqual(scene.render.resolution_percentage, 50)
            self.assertEqual(scene.render.resolution_x, 1288)
            self.assertEqual(scene.camera, cameras[0])
            if folder == INGRESS:
                self.assertEqual(scene.render.image_settings.color_depth, "8")
                self.assertEqual(scene.eevee.taa_render_samples, 64)
            self.assertEqual(len(cameras), 2)
            self.assertAlmostEqual(
                (
                    cameras[1].matrix_world.translation
                    - cameras[0].matrix_world.translation
                ).length,
                0.12,
                places=6,
            )
            for config in params["models"]:
                root = models[config["name"]]
                for actual, expected in zip(
                    root.matrix_world.translation,
                    config["pose"]["translation_m"],
                ):
                    self.assertAlmostEqual(actual, expected, places=5)
                self.assertTrue(root.children)

    def test_existing_overrides_and_rectification_guards(self):
        result = self.ingress.apply_ingress_overrides(
            self.params,
            {
                "start": 50,
                "stop": 10,
                "increment": 1,
                "sun": {"azimuth_deg": 90, "elevation_deg": 15},
                "target_model": "NEAR Shoemaker.glb",
            },
        )
        self.assertEqual(result["trajectory"]["start_position_m"], [0, 50, 0])
        self.assertEqual(result["trajectory"]["max_step_m"], 1)
        self.assertEqual(result["models"][0]["file"], "NEAR Shoemaker.glb")
        self.assertEqual(
            result["environment"]["sun"]["direction"]["azimuth_deg"], 90
        )
        self.assertEqual(
            self.params["trajectory"]["start_position_m"], [0, 100, 0]
        )
        self.ingress.validate_stereo_trajectory(result)
        result["trajectory"]["end_position_m"][1] = 0
        with self.assertRaises(ValueError):
            self.ingress.validate_stereo_trajectory(result)

    def test_default_dry_run_and_reverse_stationary_nondivisible_paths(self):
        cases = (
            ({}, 181, 100, 10, 0.5),
            ({"start": 10, "stop": 11, "increment": 0.3}, 5, 10, 11, 0.25),
            ({"start": 10, "stop": 10}, 1, 10, 10, 0),
        )
        with tempfile.TemporaryDirectory() as directory:
            for index, (overrides, count, start, end, step) in enumerate(
                cases
            ):
                with self.subTest(overrides=overrides):
                    output = Path(directory) / str(index)
                    log = self.ingress.run_ingress(
                        overrides, True, output_dir=output
                    )
                    self.assertEqual(len(log["frames"]), count)
                    self.assertEqual(log["frames"][0]["distanceMeters"], start)
                    self.assertEqual(log["frames"][-1]["distanceMeters"], end)
                    self.assertAlmostEqual(
                        log["metadata"]["trajectory"]["stepMeters"], step
                    )
                    positions = [
                        frame["positionWorldMeters"] for frame in log["frames"]
                    ]
                    for previous, current in zip(positions, positions[1:]):
                        self.assertLessEqual(
                            math.dist(previous, current),
                            log["metadata"]["trajectory"][
                                "requestedMaxStepMeters"
                            ]
                            + 1e-6,
                        )
                    self.assertEqual(
                        log["frames"][0]["theoreticalCenterDisparityPx"],
                        round(3200 * 0.12 / start, 3),
                    )
                    self.assertTrue(
                        (output / "ground_truth_trajectory.json").is_file()
                    )
                    self.assertFalse(list((output / "left").glob("*.png")))

    def test_custom_params_and_small_stereo_render(self):
        params = self.params
        params["scene"]["render"].update(
            resolution_px=[32, 24], resolution_percentage=50, samples=1
        )
        params["trajectory"]["end_position_m"] = [0, 99.5, 0]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            params_path = output / "custom.json"
            params_path.write_text(json.dumps(params), encoding="utf-8")
            log = self.ingress.run_ingress(
                params_path=params_path, output_dir=output
            )
            self.assertEqual(len(log["frames"]), 2)
            self.assertEqual(
                log["metadata"]["camera"]["resolution"],
                {"width": 16, "height": 12},
            )
            for frame in log["frames"]:
                for field in ("leftImage", "rightImage"):
                    data = (output / frame[field]).read_bytes()
                    self.assertEqual(
                        struct.unpack(">II", data[16:24]), (16, 12)
                    )
            saved = json.loads(
                (output / "ground_truth_trajectory.json").read_text()
            )
            self.assertEqual(saved, log)

    def test_cli_honors_params_and_preserves_overrides(self):
        params = self.params
        params["scene"]["name"] = "Custom CLI scene"
        params["trajectory"]["start_position_m"] = [1, 20, 2]
        params["trajectory"]["end_position_m"] = [1, 21, 2]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            config = output / "custom.json"
            config.write_text(json.dumps(params), encoding="utf-8")
            argv = [
                "blender",
                "--",
                "--params",
                str(config),
                "--start",
                "22",
                "--increment",
                "0.3",
                "--azimuth",
                "90",
                "--dry-run",
                "--camera-spec",
                "camera_spec/bfly_pge_13s2m_cs.json",
            ]
            with patch.object(sys, "argv", argv), patch.object(
                self.ingress, "SCRIPT_DIR", output
            ):
                self.ingress.main()
            log = json.loads(
                (output / "ground_truth_trajectory.json").read_text()
            )
            self.assertEqual(log["metadata"]["name"], "Custom CLI scene")
            self.assertEqual(len(log["frames"]), 5)
            self.assertEqual(
                log["frames"][0]["positionWorldMeters"], [1, 22, 2]
            )
            self.assertEqual(
                log["frames"][-1]["positionWorldMeters"], [1, 21, 2]
            )
            self.assertEqual(
                log["metadata"]["sun"]["direction"]["azimuth_deg"], 90
            )

    def test_static_driver_rejects_motion(self):
        argv = ["blender", "--", "--params", str(INGRESS / "params.json")]
        with patch.object(sys, "argv", argv), self.assertRaises(ValueError):
            self.static.main()

    def test_static_render_uses_selected_extension(self):
        from scene_setup import build_scene

        params = load_scene_params(STATIC / "params.json")
        params["scene"]["render"].update(
            resolution_px=[16, 12], image_format="JPEG", color_mode="RGB"
        )
        scene, cameras, _ = build_scene(params, ROOT / "SynC" / "models")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            self.static.render_scene(scene, cameras, output)
            self.assertEqual(len(list(output.glob("*.jpg"))), 2)
            self.assertFalse(list(output.glob("*.png")))

    def test_universal_single_camera_static_and_motion(self):
        from render_scene import render_scene

        params = self.params
        rig = params["camera_rig"]
        rig["cameras"] = rig["cameras"][:1]
        for field in ("baseline_m", "baseline_axis", "parallel_optical_axes"):
            rig.pop(field)
        params.pop("trajectory")
        params["output"] = {"prefix": "single-view"}
        params["scene"]["render"].update(resolution_px=[16, 12], samples=1)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            log = render_scene(params, output)
            self.assertEqual(len(log["frames"]), 1)
            self.assertEqual(len(list(output.glob("*.png"))), 1)
            self.assertTrue((output / "single-view.blend").is_file())
            self.assertTrue((output / "render_manifest.json").is_file())
            image = next(iter(log["frames"][0]["images"].values()))
            self.assertTrue((output / image).is_file())
            self.assertIn("cassini", log["frames"][0]["modelToWorld"])
            params["trajectory"] = {
                "type": "linear",
                "object": "cassini",
                "frame": "world",
                "start_position_m": [0, 20, 0],
                "end_position_m": [0, 21, 0],
                "max_step_m": 0.5,
            }
            log = render_scene(params, output / "sequence")
            self.assertEqual(len(log["frames"]), 3)
            self.assertFalse(log["metadata"]["disparity_available"])
            for frame in log["frames"]:
                self.assertNotIn("theoreticalCenterDisparityPx", frame)
                self.assertEqual(len(frame["cameraToWorld"]), 1)
                self.assertTrue(
                    (
                        output / "sequence" / frame["images"]["Camera_Left"]
                    ).is_file()
                )

    def test_universal_piecewise_preserves_corners_and_zero_segments(self):
        from render_scene import render_scene
        from ingress_egress import PiecewiseLinearPath

        points = [[0, 30, 0], [0, 30, 0], [1, 30, 0], [1, 31, 0], [0, 30, 0]]
        path = PiecewiseLinearPath(points)
        self.assertAlmostEqual(path.total_length, 2 + math.sqrt(2))
        params = self.params
        params["trajectory"] = {
            "type": "piecewise_linear",
            "object": "cassini",
            "frame": "world",
            "waypoints_m": points,
            "max_step_m": 0.6,
        }
        params["scene"]["render"].update(resolution_px=[16, 12], samples=1)
        with tempfile.TemporaryDirectory() as directory:
            log = render_scene(params, directory)
            frames = log["frames"]
            self.assertEqual(len(frames), 8)
            positions = [frame["positionWorldMeters"] for frame in frames]
            self.assertEqual(positions[0], positions[-1])
            for point in points:
                self.assertIn(point, positions)
            for frame in frames:
                for image in frame["images"].values():
                    self.assertTrue((Path(directory) / image).is_file())
                actual = [
                    row[3] for row in frame["modelToWorld"]["cassini"][:3]
                ]
                for value, expected in zip(
                    actual, frame["positionWorldMeters"]
                ):
                    self.assertAlmostEqual(value, expected, places=5)
            for previous, current in zip(positions, positions[1:]):
                self.assertLessEqual(math.dist(previous, current), 0.60001)
            self.assertEqual(log["metadata"]["trajectory"]["totalFrames"], 8)
            params["trajectory"]["waypoints_m"] = [[0, 30, 0]] * 3
            log = render_scene(params, directory, dry_run=True)
            self.assertEqual(len(log["frames"]), 1)

    def test_universal_multicamera_rotated_and_sun_cli(self):
        from render_scene import render_scene, main
        import bpy
        from mathutils import Vector

        params = self.params
        rig = params["camera_rig"]
        for field in ("baseline_m", "baseline_axis", "parallel_optical_axes"):
            rig.pop(field)
        third = copy.deepcopy(rig["cameras"][0])
        third["name"] = "Camera_Third"
        third["pose"]["rotation_euler_rad"] = [0, 0, 0]
        rig["cameras"].append(third)
        params["scene"]["render"].update(resolution_px=[16, 12], samples=1)
        params["trajectory"]["end_position_m"] = [0, 100, 0]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            log = render_scene(params, output / "three")
            self.assertEqual(len(log["frames"][0]["images"]), 3)
            for image in log["frames"][0]["images"].values():
                self.assertTrue((output / "three" / image).is_file())
            self.assertFalse(log["metadata"]["disparity_available"])
            config = output / "params.json"
            config.write_text(json.dumps(params), encoding="utf-8")
            with patch.object(
                sys,
                "argv",
                [
                    "blender",
                    "--",
                    "--params",
                    str(config),
                    "--output-dir",
                    str(output / "cli"),
                    "--dry-run",
                    "--azimuth",
                    "90",
                    "--elevation",
                    "0",
                ],
            ):
                main()
            log = json.loads(
                (output / "cli" / "ground_truth_trajectory.json").read_text()
            )
            self.assertEqual(
                log["metadata"]["sun"]["direction"]["azimuth_deg"], 90
            )
            ray = bpy.data.objects["Sun_Light"].rotation_euler.to_matrix() @ (
                Vector((0, 0, -1))
            )
            self.assertAlmostEqual(ray.x, -1, places=5)
            self.assertAlmostEqual(ray.y, 0, places=5)
            self.assertAlmostEqual(ray.z, 0, places=5)

    def test_universal_unrectified_and_behind_camera_metrics(self):
        from render_scene import render_scene

        params = self.params
        params["trajectory"]["start_position_m"] = [0, 0, 0]
        params["trajectory"]["end_position_m"] = [0, -1, 0]
        with tempfile.TemporaryDirectory() as directory:
            log = render_scene(params, directory, dry_run=True)
            for frame in log["frames"]:
                self.assertNotIn("theoreticalCenterDisparityPx", frame)
                self.assertIn("disparity_unavailable_reason", frame)
            with self.assertRaises(ValueError):
                render_scene(params, directory, require_disparity=True)
            rig = params["camera_rig"]
            rig["parallel_optical_axes"] = False
            rig["cameras"][1]["pose"]["rotation_euler_rad"][2] = 0.1
            log = render_scene(params, directory, dry_run=True)
            self.assertFalse(log["metadata"]["disparity_available"])
            self.assertIn("disparity_unavailable_reason", log["metadata"])

    def test_universal_executable_cli_and_error_exit(self):
        import bpy

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            command = [
                bpy.app.binary_path,
                "--background",
                "--python-exit-code",
                "1",
                "--python",
                str(ROOT / "SynC" / "pylib" / "render_scene.py"),
                "--",
                "--params",
                str(INGRESS / "params.json"),
                "--output-dir",
                str(output),
                "--dry-run",
            ]
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=90
            )
            self.assertEqual(
                result.returncode,
                0,
                result.stdout[-3000:] + result.stderr[-3000:],
            )
            log = json.loads(
                (output / "ground_truth_trajectory.json").read_text()
            )
            self.assertEqual(len(log["frames"]), 181)
            self.assertEqual(
                log["frames"][0]["leftImage"], "left/frame_0001.png"
            )
            self.assertTrue((output / "ingress_stereo.blend").is_file())
            command[command.index("--params") + 1] = str(
                output / "missing.json"
            )
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=90
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("FileNotFoundError", result.stdout + result.stderr)

    def test_orbit_rigid_geometry_tracking_and_absolute_samples(self):
        from scene_setup import build_scene
        from orbit import CameraRigOrbit
        from mathutils import Vector

        _, cameras, models = build_scene(self.params, ROOT / "SynC" / "models")
        model_matrix = models["cassini"].matrix_world.copy()
        orbit = CameraRigOrbit(cameras, model_matrix)
        self.assertTrue(orbit.track_target)
        self.assertAlmostEqual(orbit.radius_m, 100)
        relative = cameras[0].matrix_world.inverted() @ cameras[1].matrix_world
        for t in (0, 0.25, 0.5, 0.75, 1, 0.25):
            rig = orbit.apply(t)
            self.assertAlmostEqual(
                (rig.translation - orbit.center).length, 100, places=4
            )
            forward = rig.to_3x3() @ Vector((0, 0, -1))
            direction = (orbit.center - rig.translation).normalized()
            self.assertGreater(forward.normalized().dot(direction), 0.999999)
            baseline = cameras[1].matrix_world.translation - (
                cameras[0].matrix_world.translation
            )
            self.assertAlmostEqual(baseline.length, 0.12, places=5)
            actual_relative = cameras[0].matrix_world.inverted() @ (
                cameras[1].matrix_world
            )
            for row, expected_row in zip(actual_relative, relative):
                for actual, expected in zip(row, expected_row):
                    self.assertAlmostEqual(actual, expected, places=4)
            for camera in cameras:
                view = camera.matrix_world.to_3x3() @ Vector((0, 0, -1))
                self.assertGreater(view.normalized().dot(direction), 0.999999)
        self.assertLess(
            (orbit.position_at(0) - orbit.position_at(1)).length, 1e-6
        )
        self.assertLess(
            (orbit.position_at(0.25) - Vector((100, 100, 0))).length, 1e-4
        )
        self.assertEqual(models["cassini"].matrix_world, model_matrix)

    def test_orbit_tracking_false_reverse_arc_and_validation(self):
        from scene_setup import build_scene
        from orbit import CameraRigOrbit
        from mathutils import Vector

        _, cameras, models = build_scene(self.params, ROOT / "SynC" / "models")
        rotations = [camera.matrix_world.to_3x3().copy() for camera in cameras]
        orbit = CameraRigOrbit(
            cameras,
            models["cassini"].matrix_world,
            radius_m=10,
            start_angle_deg=90,
            sweep_angle_deg=-90,
            track_target=False,
        )
        self.assertAlmostEqual(orbit.arc_length, math.pi * 5)
        self.assertLess(
            (orbit.position_at(0) - Vector((10, 100, 0))).length, 1e-4
        )
        self.assertLess(
            (orbit.position_at(1) - Vector((0, 90, 0))).length, 1e-4
        )
        for t in (0, 0.4, 1):
            orbit.apply(t)
            for camera, rotation in zip(cameras, rotations):
                for row, expected in zip(
                    camera.matrix_world.to_3x3(), rotation
                ):
                    for value, target in zip(row, expected):
                        self.assertAlmostEqual(value, target, places=5)
        for t in (-0.1, 1.1, float("nan")):
            with self.assertRaises(ValueError):
                orbit.apply(t)
        for values in (
            {"radius_m": -1},
            {"track_target": "true"},
            {"axis_world": (0, 0, 0)},
            {"axis_world": (0, 1, 0)},
        ):
            _, cameras, models = build_scene(
                self.params, ROOT / "SynC" / "models"
            )
            with self.subTest(values=values), self.assertRaises(ValueError):
                CameraRigOrbit(
                    cameras, models["cassini"].matrix_world, **values
                )
        with self.assertRaises(ValueError):
            CameraRigOrbit([], models["cassini"].matrix_world)

    def test_universal_orbit_render_metadata_and_disabled_tracking(self):
        from render_scene import render_scene
        from mathutils import Matrix, Vector

        params = self.params
        params["scene"]["render"].update(resolution_px=[16, 12], samples=1)
        params["trajectory"] = {
            "type": "orbit",
            "target": "cassini",
            "frame": "world",
            "radius_m": 5,
            "sweep_angle_deg": 90,
            "max_step_m": 3,
        }
        params["output"]["prefix"] = "camera-orbit"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            log = render_scene(params, output)
            self.assertEqual(len(log["frames"]), 4)
            self.assertTrue((output / "camera-orbit.blend").is_file())
            self.assertFalse(log["metadata"]["disparity_available"])
            metadata = log["metadata"]["trajectory"]
            self.assertTrue(metadata["track_target"])
            self.assertEqual(metadata["moved_entity"], "camera_rig")
            self.assertLessEqual(metadata["stepMeters"], 3)
            model_matrix = log["frames"][0]["modelToWorld"]["cassini"]
            for frame in log["frames"]:
                self.assertEqual(
                    frame["modelToWorld"]["cassini"], model_matrix
                )
                self.assertNotIn("theoreticalCenterDisparityPx", frame)
                rig = Matrix(frame["rigToWorld"])
                center = Matrix(model_matrix).translation
                self.assertAlmostEqual(
                    (rig.translation - center).length, 5, places=4
                )
                for field in ("leftImage", "rightImage"):
                    data = (output / frame[field]).read_bytes()
                    self.assertEqual(
                        struct.unpack(">II", data[16:24]), (16, 12)
                    )
                left, right = (
                    Matrix(frame["cameraToWorld"][name])
                    for name in ("Camera_Left", "Camera_Right")
                )
                self.assertAlmostEqual(
                    (right.translation - left.translation).length,
                    0.12,
                    places=5,
                )
            self.assertEqual(
                json.loads(
                    (output / "ground_truth_trajectory.json").read_text()
                ),
                log,
            )
            params["trajectory"]["track_target"] = False
            params["trajectory"]["sweep_angle_deg"] = 0
            log = render_scene(params, output / "fixed", dry_run=True)
            self.assertEqual(len(log["frames"]), 1)
            self.assertEqual(log["metadata"]["trajectory"]["stepMeters"], 0)
            self.assertFalse(log["metadata"]["trajectory"]["track_target"])
            view = Matrix(
                log["frames"][0]["cameraToWorld"]["Camera_Left"]
            ).to_3x3() @ Vector((0, 0, -1))
            self.assertGreater(view.y, 0.999999)
            import bpy

            command = [
                bpy.app.binary_path,
                "--background",
                "--python-exit-code",
                "1",
                "--python",
                str(ROOT / "SynC" / "pylib" / "render_scene.py"),
                "--",
                "--params",
                str(self._write_params(output, params)),
                "--output-dir",
                str(output / "cli-orbit"),
                "--dry-run",
            ]
            result = subprocess.run(
                command, capture_output=True, text=True, timeout=90
            )
            self.assertEqual(
                result.returncode,
                0,
                result.stdout[-3000:] + result.stderr[-3000:],
            )
            cli_log = json.loads(
                (
                    output / "cli-orbit" / "ground_truth_trajectory.json"
                ).read_text()
            )
            self.assertFalse(cli_log["metadata"]["trajectory"]["track_target"])
            self.assertEqual(len(cli_log["frames"]), 1)
            with self.assertRaises(ValueError):
                self.ingress.run_ingress(
                    params_path=self._write_params(output, params),
                    output_dir=output,
                    dry_run=True,
                )

    def test_orbit_tilted_plane_and_single_camera(self):
        from scene_setup import build_scene
        from orbit import CameraRigOrbit
        from mathutils import Vector

        _, cameras, models = build_scene(self.params, ROOT / "SynC" / "models")
        orbit = CameraRigOrbit(
            cameras,
            models["cassini"].matrix_world,
            axis_world=(1, 0, 0),
            radius_m=10,
        )
        for t in (0, 0.25, 0.5, 0.75, 1):
            rig = orbit.apply(t)
            self.assertAlmostEqual(
                (rig.translation - orbit.center).dot(orbit.axis), 0, places=5
            )
            up = rig.to_3x3() @ Vector((0, 1, 0))
            self.assertGreater(up.dot(orbit.axis), 0.999999)
            self.assertAlmostEqual(rig.to_3x3().determinant(), 1, places=5)
        self.assertLess(
            (orbit.position_at(0.25) - Vector((0, 100, -10))).length, 1e-4
        )
        params = self.params
        params["camera_rig"]["cameras"] = params["camera_rig"]["cameras"][:1]
        for field in ("baseline_m", "baseline_axis", "parallel_optical_axes"):
            params["camera_rig"].pop(field)
        params["output"].pop("camera_directories")
        params["trajectory"] = {
            "type": "orbit",
            "target": "cassini",
            "frame": "world",
            "max_step_m": 100,
            "sweep_angle_deg": 45,
        }
        from render_scene import render_scene

        with tempfile.TemporaryDirectory() as directory:
            log = render_scene(params, directory, dry_run=True)
            self.assertEqual(len(log["frames"]), 2)
            self.assertEqual(len(log["frames"][0]["images"]), 1)

    @staticmethod
    def _write_params(directory, params):
        path = Path(directory) / "orbit.json"
        path.write_text(json.dumps(params), encoding="utf-8")
        return path


if __name__ == "__main__":
    unittest.main(argv=[__file__])
