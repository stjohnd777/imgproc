"""Render one static Cassini image using the shared SynC scene schema."""

import argparse
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "SynC" / "pylib"))
from scene_config import load_scene_params  # noqa: E402
from render_scene import render_scene as render_configured_scene  # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        description="Build and render a static single-camera scene from JSON."
    )
    parser.add_argument(
        "--output-dir",
        default=str(SCRIPT_DIR),
        help="Directory for the image, Blender scene, and manifest.",
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
            "The single-image driver does not execute trajectories. "
            "Use SynC/pylib/render_scene.py for a trajectory configuration."
        )
    if len(params["camera_rig"]["cameras"]) != 1:
        raise ValueError("The single-image driver requires exactly one camera.")
    render_configured_scene(
        params,
        args.output_dir,
        models_dir=PROJECT_ROOT / "SynC" / "models",
    )


if __name__ == "__main__":
    main()
