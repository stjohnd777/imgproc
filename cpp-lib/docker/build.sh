#!/usr/bin/env bash
set -euo pipefail

# Run from anywhere; build context is cpp-lib/ so future COPY steps can reach the source tree.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CPP_LIB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="navlib-dev"
TAG="${1:-latest}"

docker build \
    -t "${IMAGE_NAME}:${TAG}" \
    -f "$SCRIPT_DIR/Dockerfile" \
    "$CPP_LIB_DIR"

echo "Built ${IMAGE_NAME}:${TAG}"
