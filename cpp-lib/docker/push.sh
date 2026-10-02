#!/usr/bin/env bash
set -euo pipefail

# Requires you to already be authenticated: run `docker login` yourself first.
# Never put your Docker Hub password/token in this script or pass it as a CLI arg.

IMAGE_NAME="navlib-dev"
TAG="${1:-latest}"
DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:?Set DOCKERHUB_USERNAME env var, e.g. DOCKERHUB_USERNAME=myuser ./push.sh}"

LOCAL_IMAGE="${IMAGE_NAME}:${TAG}"
REMOTE_IMAGE="${DOCKERHUB_USERNAME}/${IMAGE_NAME}:${TAG}"

if ! docker image inspect "$LOCAL_IMAGE" > /dev/null 2>&1; then
    echo "Local image '$LOCAL_IMAGE' not found -- build it first with ./build.sh ${TAG}" >&2
    exit 1
fi

docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"
docker push "$REMOTE_IMAGE"

echo "Pushed ${REMOTE_IMAGE}"
