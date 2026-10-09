
# Orbital Eyes

An Electron/OpenCV workbench for image processing, visual workflows, and
Blender-generated spacecraft scenes. Development is currently validated on macOS.

## Prerequisites

- Node.js and npm (development uses Node 24).
- CMake and a C++17 compiler.
- OpenCV with contrib modules and nlohmann-json.
- Optional: Blender for synthetic rendering; it is not required for ordinary
  image processing.

On macOS with Homebrew, install the native dependencies:

```sh
xcode-select --install
brew install node cmake opencv nlohmann-json
```

SURF additionally needs OpenCV built with nonfree support enabled. If SURF
reports that it is unavailable, use another detector such as SIFT or ORB.

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

From the repository root, use the existing build helper:

```sh
bash build_cli.sh
```

To build only selected tools:

```sh
bash build_cli.sh sift orb disparity stereo-calibration
```

Executables are generated under `cv-cli/cpp-<tool>/build/`. The helper stops
at the first build failure. In VS Code, you can alternatively configure the
desired native project with CMake Tools and use **CMake: Build**.

## Run

```sh
npm start
```

Use image tabs for individual operations, **Workflow** for connected processing
steps, and **Scene Composer** for synthetic scenes. Restart the app after
changing installed element definitions.

[app.json](app.json) configures results, model, and saved-scene directories.
Results default to `~/data/workflows`; models default to `SynC/models`.

## More information

- [Native CLI usage and examples](cv-cli/README.md)
- [Synthetic rendering and Scene Composer](SynC/README.md)
- [Stereo calibration and rectification](cv-cli/cpp-stereo-calibration/README.md)
