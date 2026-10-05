#!/usr/bin/env zsh
set -e

DIR="${0:A:h}"
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"

if [ ! -f "$BLENDER" ]; then
    if command -v blender >/dev/null 2>&1; then
        BLENDER="$(command -v blender)"
    else
        echo "Error: Blender not found at $BLENDER or in PATH."
        exit 1
    fi
fi

echo "Running build_ingress_scene.py with Blender from $DIR..."
"$BLENDER" --background --python-exit-code 1 \
    --python "$DIR/build_ingress_scene.py" -- "$@"
