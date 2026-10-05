"""Schema tests plus Blender integration checks (run with Blender --python)."""

import copy
import importlib.util
import json
import math
from pathlib import Path
import struct
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
            lambda p: p["trajectory"].update(type="orbit"),
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


if __name__ == "__main__":
    unittest.main(argv=[__file__])
