# Orbital Eyes Help

Orbital Eyes is a workbench for synthetic spacecraft imagery and visual
navigation. This page is a placeholder that will grow into the user guide.

## Getting started

- [Install, build and run](Readme.md)
- [Native OpenCV command-line tools](cv-cli/README.md)
- [Feature output formats](cv-cli/FEATURE_OUTPUTS.md)
- [SynC synthetic scene generator](SynC/README.md)

## Working in the app

- **Explorer** (folder button): open a folder of images, then run toolbar
  operations on the selected image.
- **Workflow**: drag elements from the palette, connect ports, then **Plan**
  and **Run**. Box-select with the mouse; use Cmd+C / Cmd+X / Cmd+V /
  Cmd+D, Delete, and Cmd+Z / Shift+Cmd+Z.
- **Scene Composer**: build and preview Blender scenes for the synthetic
  camera.

## Configuration

Settings come from `app.json` in the app folder, overridden by an `app.json`
in the per-user settings folder (shown in **About Orbital Eyes**). Keys:
`resultsDir`, `modelsDir`, `scenesDir`, `toolTimeoutMs`, `nativeDir`,
`cliDir`, `blenderPath`, `pythonPath`, `usbCameraCli`. Native tools are found
in `nativeDir/bin` first, then in `cliDir/cpp-<tool>/build`.

## Developer notes

- [Handoff notes](HANDOFF.md)
- [Design](design.md)
- [Review](review.md)
