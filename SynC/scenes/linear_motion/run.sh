#!/usr/bin/env zsh
set -e

DIR="${0:A:h}"
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"

if [ ! -f "$BLENDER" ]; then
    if command -v blender >/dev/null 2>&1; then
        BLENDER="$(command -v blender)"
    else
        echo "Error: Blender not found at $BLENDER or in PATH." >&2
        exit 1
    fi
fi

echo "Rendering Cassini diagonal motion from $DIR..."
PYTHONDONTWRITEBYTECODE=1 "$BLENDER" --background --python-exit-code 1 \
    --python "$DIR/../../pylib/render_scene.py" -- \
    --params "$DIR/params.json" --output-dir "$DIR/output" "$@"
