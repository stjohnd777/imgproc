
# Orbital Eyes

An Electron/OpenCV workbench for image processing, visual workflows, and
Blender-generated spacecraft scenes. It targets macOS, Windows and Linux; daily
development is on macOS, and CI builds all three.

## Prerequisites

- Node.js and npm (Node 24).
- CMake 3.21 or newer and a C++17 compiler: Xcode command-line tools on macOS,
  Visual Studio 2022 (Desktop C++) on Windows, GCC or Clang on Linux.
- [vcpkg](https://github.com/microsoft/vcpkg), with `VCPKG_ROOT` pointing at the
  checkout. vcpkg builds OpenCV from [cv-cli/vcpkg.json](cv-cli/vcpkg.json) so
  the tools ship with their own libraries.
- Optional: Blender for synthetic rendering. It is not required for ordinary
  image processing and is not bundled.

```sh
git clone https://github.com/microsoft/vcpkg.git ~/vcpkg
~/vcpkg/bootstrap-vcpkg.sh        # Windows: ~\vcpkg\bootstrap-vcpkg.bat
export VCPKG_ROOT=~/vcpkg         # Windows: setx VCPKG_ROOT %USERPROFILE%\vcpkg
```

On Linux, vcpkg's OpenCV build also needs
`nasm pkg-config autoconf automake libtool` (`apt install ...`).

## Clone and install

```sh
git clone https://github.com/stjohnd777/imgproc.git
cd imgproc
npm ci
```

Optional submodules, including cFS, are not needed to run the desktop app.
To fetch them:

```sh
git submodule update --init --recursive
```

## Build the native tools

```sh
npm run build:native          # vcpkg build, installs every tool into native/
npm run smoke:native          # runs a few tools on img/one.png
```

The first vcpkg build compiles OpenCV (a few minutes); later builds reuse
vcpkg's binary cache. The script picks the triplet for this machine
(`arm64-osx-oe`, `x64-osx-oe`, `x64-linux-oe`, `arm64-linux-oe`,
`x64-windows-oe`); override it with `--triplet`, and use `--clean` for a fresh
build. The result is self-contained:

```text
native/
  bin/            *_cli tools (*.exe on Windows, next to the OpenCV DLLs)
  lib/            OpenCV and codec shared libraries (macOS, Linux)
  native-info.json  OpenCV version, triplet and tool list (shown in About)
```

The vcpkg OpenCV omits `opencv_contrib` nonfree, so SURF is not built; use SIFT
or ORB instead. To build against an OpenCV you already have (for example
`brew install opencv nlohmann-json`, which includes SURF), run
`npm run build:native:system`; those tools link the system libraries in place
and are for local development only.

The app looks for each tool in `native/bin` first, then in the older
per-project folders `cv-cli/cpp-<tool>/build/`, so `bash build_cli.sh`
(`npm run build:cli`, macOS/Linux) and VS Code CMake Tools builds still work.

## Run

```sh
npm start        # normal launch
npm run dev      # also opens DevTools (or set ORBITAL_EYES_DEV=1)
npm test         # unit tests
```

Use image tabs for individual operations, **Workflow** for connected processing
steps, and **Scene Composer** for synthetic scenes. Restart the app after
changing installed element definitions. **Help → Orbital Eyes Help** (F1) and
**Orbital Eyes → About** show documentation, the version, the OpenCV version and
the native tools that are built.

## Configuration

[app.json](app.json) holds the defaults. A per-user `app.json` overrides any
key, so a packaged app can be reconfigured without editing the bundle:

- macOS: `~/Library/Application Support/Orbital Eyes/app.json`
- Windows: `%APPDATA%\Orbital Eyes\app.json`
- Linux: `~/.config/Orbital Eyes/app.json`

| Key | Meaning |
| --- | --- |
| `resultsDir` | Workflow run output (default `~/data/workflows`) |
| `modelsDir` | Scene models (default `SynC/models`) |
| `scenesDir` | Saved Scene Composer scenes |
| `toolTimeoutMs` | Per-tool timeout |
| `nativeDir` | Installed native tools (default `native`) |
| `cliDir` | Element tool definitions and per-project builds (default `cv-cli`) |
| `blenderPath` | Blender executable. Default: found in `/Applications` (macOS), the newest `Program Files\Blender Foundation` install (Windows) or `/usr/bin`, `/snap/bin`, ... (Linux); otherwise `blender` on `PATH` |
| `pythonPath` | Python interpreter for future training tools (`python3`; `python` on Windows) |
| `usbCameraCli` | Optional explicit path to `usb_camera_cli` |

Relative paths resolve against the app folder; `~` expands to your home folder.
Workflows that use a missing native tool are reported when you click **Plan**.

## Package the app

Build `native/` first; packaging refuses to run without it.

```sh
npm run build:native
npm run pack          # unpacked app in dist/ (quick check)
npm run dist:mac      # .dmg and .zip
npm run dist:win      # NSIS installer (.exe), run on Windows
npm run dist:linux    # AppImage and .tar.gz, run on Linux (or in Docker)
```

Each platform is packaged on that platform, because the native tools are built
there. The GitHub Actions workflow
[.github/workflows/build.yml](.github/workflows/build.yml) builds, tests and
packages all three and uploads the installers as artifacts. To build the Linux
packages from a Mac, use the Docker image described in
[docker/README.md](docker/README.md).

Signing: without a certificate, packaging is unsigned (macOS uses ad-hoc
signatures; set `CSC_IDENTITY_AUTO_DISCOVERY=false` to skip the search). To
sign, set `CSC_NAME` (macOS Developer ID) or `CSC_LINK`/`CSC_KEY_PASSWORD`
(Windows code-signing certificate). Notarization is not configured yet.
Blender is not bundled; install it separately for synthetic rendering.

## More information

- [Native CLI usage and examples](cv-cli/README.md)
- [Synthetic rendering and Scene Composer](SynC/README.md)
- [Stereo calibration and rectification](cv-cli/cpp-stereo-calibration/README.md)
