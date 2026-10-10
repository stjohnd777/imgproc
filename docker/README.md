# Docker

Docker is used for Linux builds and, later, for headless work. The desktop app
itself runs natively on each platform; it does not run in a container.

## Linux build image

[linux-build.Dockerfile](linux-build.Dockerfile) contains Node 24, CMake, a
compiler and vcpkg pinned to the baseline in `cv-cli/vcpkg.json`. It builds the
native tools, runs the smoke and unit tests and makes the Linux packages. It
works on a copy of the source, so your checkout's `native/`, `build/` and
`node_modules/` are left alone.

From the repository root:

```sh
docker build -t orbital-eyes-linux-build -f docker/linux-build.Dockerfile docker
docker run --rm -v "$PWD":/src:ro -v oe-vcpkg-cache:/vcpkg-cache \
    -v "$PWD/dist-linux":/out orbital-eyes-linux-build
```

- The `oe-vcpkg-cache` volume keeps vcpkg's binary cache, so OpenCV is only
  compiled once.
- `/out` receives the AppImage, the `.tar.gz` and the built `native/` folder.
- Add `--no-dist` after the image name to build and test without packaging.
- On an Apple Silicon Mac the container is arm64 Linux, so it produces
  `arm64-linux-oe` packages. Add `--platform linux/amd64` to both commands for
  x64 packages (much slower under emulation); CI builds x64 natively.

## Planned images

- Headless Blender for Monte Carlo scene rendering.
- PyTorch training for the stereo pose network.
