#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR/cv-cli"

usage() {
    cat <<'EOF'
Usage: ./build_cli.sh [tool ...]

Build all cv-cli/cpp-* CMake projects, or only the named tools.

Examples:
  ./build_cli.sh
  ./build_cli.sh sift orb corners
  CMAKE_BUILD_PARALLEL_LEVEL=4 ./build_cli.sh

Requires CMake, a C++17 compiler, OpenCV, and nlohmann_json.
SURF also requires OpenCV contrib; execution needs nonfree support.
Outputs stay in cv-cli/cpp-<tool>/build/, as expected by Electron.
Existing CMake caches are reused. Stops at the first failed build.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

if ! command -v cmake >/dev/null 2>&1; then
    echo "CMake was not found. Install CMake and the native dependencies first." >&2
    exit 1
fi

projects=()
if [[ $# -eq 0 ]]; then
    for project in "$CLI_DIR"/cpp-*; do
        [[ -f "$project/CMakeLists.txt" ]] || continue
        projects+=("$project")
    done
else
    # Validate every requested name before starting any builds.
    for tool in "$@"; do
        name="${tool#cpp-}"
        if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
            [[ ! -f "$CLI_DIR/cpp-$name/CMakeLists.txt" ]]; then
            echo "Unknown CLI tool: $tool. Use --help for usage." >&2
            exit 1
        fi
        projects+=("$CLI_DIR/cpp-$name")
    done
fi

if [[ ${#projects[@]} -eq 0 ]]; then
    echo "No CLI CMake projects found in $CLI_DIR." >&2
    exit 1
fi

for project in "${projects[@]}"; do
    echo "Building ${project##*/}"
    cmake -S "$project" -B "$project/build"
    cmake --build "$project/build"
done

echo "Built ${#projects[@]} CLI project(s)."
