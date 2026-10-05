"""Render a static stereo pair using the shared SynC scene schema."""

import argparse
from pathlib import Path
import sys

import bpy

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "SynC" / "pylib"))
from scene_config import load_scene_params  # noqa: E402
from scene_setup import build_scene, render_camera  # noqa: E402


def render_scene(scene, cameras, output_dir):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = "cassini-stereo-pair"
    scene.camera = cameras[0]
    bpy.ops.wm.save_as_mainfile(filepath=str(output_dir / f"{stem}.blend"))
    for camera in cameras:
        path = render_camera(
            scene, camera, output_dir / f"{stem}_{camera.name.lower()}"
        )
        print(f"Saved {camera.name}: {path}")


def main():
    parser = argparse.ArgumentParser(
        description="Build and render a static stereo scene from JSON."
    )
    parser.add_argument(
        "--params",
        default=str(SCRIPT_DIR / "params.json"),
        help="Path to the scene parameter JSON file.",
    )
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    params = load_scene_params(args.params)
    if "trajectory" in params:
        raise ValueError(
            "The static-pair driver does not execute trajectories. "
            "Use build_ingress_scene.py for a trajectory configuration."
        )
    scene, cameras, _ = build_scene(params, PROJECT_ROOT / "SynC" / "models")
    render_scene(scene, cameras, SCRIPT_DIR)


if __name__ == "__main__":
    main()
