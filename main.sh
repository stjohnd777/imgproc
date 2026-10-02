#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -x "node_modules/.bin/electron" ]]; then
    echo "Electron is not installed. Run: npm install" >&2
    exit 1
fi

npm start -- "$@"
