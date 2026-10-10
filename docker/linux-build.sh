#!/usr/bin/env bash
# Entry point for docker/linux-build.Dockerfile.
#   oe-linux-build            build native/, run smoke and unit tests, package into /out (if mounted)
#   oe-linux-build --no-dist  skip electron-builder
set -euo pipefail

dist=1
[[ "${1:-}" == "--no-dist" ]] && dist=0

# Work on a copy so the host checkout's native/, build/ and node_modules are never touched.
rsync -a --delete \
    --exclude node_modules --exclude /build --exclude /native --exclude /dist --exclude .git \
    --exclude '/cv-cli/cpp-*/build' --exclude /_basement --exclude vcpkg_installed \
    /src/ /work/

npm ci
node scripts/build-native.mjs
npm run smoke:native
npm test

if [[ $dist == 1 ]]; then
    npx electron-builder --linux --publish never
    if [[ -d /out ]]; then
        cp dist/*.AppImage dist/*.tar.gz /out/
        cp -r native /out/native
        echo "Packages copied to /out"
    fi
fi
