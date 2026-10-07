"""Render a static stereo pair using the shared SynC scene schema."""

import argparse
from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "SynC" / "pylib"))
from scene_config import load_scene_params  # noqa: E402
from render_scene import (  # noqa: E402
    render_scene as render_configured_scene,
    render_static_views,
)


def render_scene(scene, cameras, output_dir):
    return render_static_views(
        scene, cameras, output_dir, "cassini-stereo-pair"
    )


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
    render_configured_scene(
        params,
        SCRIPT_DIR,
        models_dir=PROJECT_ROOT / "SynC" / "models",
        prefix="cassini-stereo-pair",
    )


if __name__ == "__main__":
    main()
