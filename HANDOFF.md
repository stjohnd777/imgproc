# Handoff

Updated: 2026-10-08.

Latest scaffold: **Stereo Pose Estimator** (`stereo_pose_estimator`) in the
new **AI/ML** palette category. Its C++17 project and workflow mapping accept
left/right images, configured ONNX model/metadata files, and a pose JSON path.
Model files require workflow authorization. The CLI deliberately exits with
an explicit not-implemented error and writes no pose. ONNX Runtime is selected
but not yet linked; inference, metadata parsing, training, and model export
remain future work. See [CLI contract](cv-cli/cpp-stereo-pose/README.md).

Workflow editor (latest, pending): click/Shift/Cmd-click and box selection,
group drag, Cmd+A/C/X/V/D, Delete for nodes or a selected connection, Esc,
and per-tab undo/redo (Cmd+Z, Shift+Cmd+Z, Ctrl+Y; 100 steps). The clipboard
is shared across workflow tabs; paste keeps only connections internal to the
copied nodes and assigns new IDs. Shortcuts are ignored while typing or with a
dialog open. Covered by `workflow_editing.test.js` plus a browser check.

## Project and repository state

- Project: `/Users/danielst.johnst.john/development/electron/hello-world`
- Repository: `stjohnd777/imgproc`
- Current branch: `main`
- Latest commit at handoff: `b92f2e2` - stereo fix fractional detector coordinates with integer matching coordinates.
- There are pending stereo calibration, dense disparity, and documentation
  changes. Do not assume everything is committed.
- Unrelated modifications currently include `.idea/vcs.xml` and an extra
  blank line in `cv-cli/cpp-sift/sift_cli.cpp`. Preserve user changes.
- The earlier Scene Composer work was done on `scene_composer`; the current
  checkout is now `main`. Verify branch before future implementation.

This replaces an outdated handoff that incorrectly said the elements were
all untracked, Disparity had no implementation, and only SIFT exported JSON.

## Goal and architecture

**Orbital Eyes** is an Electron/OpenCV workbench for synthetic spacecraft
imagery, image-processing workflows, and visual navigation research for
rendezvous/proximity operations (RPO).

The user's focus is a Linux-hosted satellite visual-navigation component
combining camera images and GNC estimates to produce range, bearing, and
relative attitude. A cFS-independent navigation engine with a thin cFS adapter
was discussed; no cFS workflow integration has been implemented.

| File or directory | Role |
|---|---|
| [main.js](main.js) | Electron filesystem/process access, CLI allow-list, workflow planning/execution |
| [preload.cjs](preload.cjs) | Renderer IPC bridge |
| [Data.js](Data.js) | Tab/sidebar/spec models and port compatibility |
| [Controller.js](Controller.js) | Model/view coordination and local/REST runners |
| [View.js](View.js) | UI, workflow canvas, schema-driven configuration dialogs |
| [index.html](index.html) | Application markup, styles, setup and toolbar |
| [app.json](app.json) | Results, timeout, model catalog and saved-scene settings |
| [elements/](elements/) | Workflow element declarations |
| [cv-cli/](cv-cli/) | Native OpenCV executables and documentation |
| [SynC/](SynC/) | Blender scene generation, models and tests |
| [scene_composer.js](scene_composer.js) | Three.js scene viewport/editor |
| [scene_composer_document.js](scene_composer_document.js) | Scene transforms, validation, camera aiming |
| [scene_composer_storage.js](scene_composer_storage.js) | Configured model catalog and scene CRUD |

Environment used: macOS, Electron 44, Node 24, ESM JavaScript, Homebrew
OpenCV 4.11, Blender 4.1.1 at
`/Applications/Blender.app/Contents/MacOS/Blender`, Three.js 0.180.
SURF availability depends on the installed OpenCV contrib/nonfree build.

## Established behavior

- Workflow edges carry artifact file paths; one output can feed several inputs.
- Runs persist under the configured results directory; scratch is separate.
- Main reads trusted installed element definitions rather than accepting
  executable definitions from the renderer.
- Processes execute without a shell. Files/folders require authorization;
  manually entering a path does not automatically grant access.
- Workflow documents preserve parameters and reconstruct ports from current
  element definitions when loaded.
- Shared schema dialogs support numeric, enum, boolean, path, camera-profile,
  text, and multiline code settings.
- UIView and UIViewText open workflow artifacts; preview tabs can be reused.
- Results management supports inspecting runs and constrained deletion.
- The free-form image toolbar is separate from workflow execution.

## Previously completed features

### Synthetic scenes and Scene Composer

- Universal JSON-driven Blender renderer with static, linear-motion, and
  camera-rig trajectory support.
- Model catalog from `app.json` `modelsDir` (default `SynC/models`).
- Saved scenes from `scenesDir` (default `~/data/workflows/scenes`).
- Local GLB/Draco loading, drag/drop placement, orbit/pan/zoom, translation/
  rotation gizmos, numeric poses and rigid row-major local-to-world T matrices.
- Scene save/load/import/delete, advanced JSON, undo/redo, Blender preview.
- Camera **Aim at Target** preserves position and rotates toward a model
  origin; this is one-time aiming, not a tracking constraint.
- Resizable inspector divider and larger vertically resizable T editor.
- Actual Electron/Blender verification previously loaded 27 models and
  produced a visible preview; pose matrices were compared against Blender.
- Unknown scene fields/trajectories are preserved. Static previews remove
  trajectory only from their render snapshot.

Known issue from the inspector change: its body ResizeObserver was not retained
and disconnected on disposal. Do not silently bundle this into unrelated work.

### Utilities and image effects

- Process Text runs synchronous JSON-in/JSON-out JavaScript in a worker with
  timeout/size checks. It is for trusted scripts, not a security sandbox.
- SplitterText forwards an unchanged text artifact to two outputs.
- Splitter 3 / Splitter 4 (`splitter3`, `splitter4`) forward one image to
  three or four outputs with the same passthrough; see `splitter_multi.test.js`.
- Horizontal/Vertical Concat preserve exact image pixels and alpha, require
  matching depth/channels and matching non-concatenated dimensions.
- Image Diff uses `cv::absdiff`, not addition. An earlier challenged output
  exactly matched frames 102 and 106 of the linear-motion sequence.
- Several effects support 8/16-bit images; many older CLIs still load 8-bit
  color. Consult each README rather than assuming uniform depth support.

## Latest stereo work

### Sparse stereo coordinate bug - committed

[simple_stereo_cli.cpp](cv-cli/cpp-simple-stereo/simple_stereo_cli.cpp) is a
**sparse NCC block matcher**, not a descriptor matcher:

1. Round left detector coordinates and extract an integer-centered patch.
2. Search integer right-image locations over the disparity range/vertical band.
3. Select the best normalized correlation and triangulate.

The bug mixed fractional left detector coordinates with integer matching
coordinates. Left output coordinates now use the actual rounded patch center;
disparity and all triangulated axes use consistent coordinates.
Identical-image matches produce zero disparity and null 3D, and do not enter
the point cloud or position average.

Regression: [simple_stereo.test.mjs](cv-cli/test/simple_stereo.test.mjs).
Both tests failed before the fix and passed afterward. The matcher remains
integer-pixel; subpixel refinement was recommended but is not implemented.

Native baseline is **millimeters**; exported point3d/PLY/position values are
meters. Native fx defaults to **1000 px**, fy to the selected fx, while the
workflow defaults to **3200 px** for both.

The user's supplied average point `[0.6514545454545455,
-1.2269917355371902, 95.41818181818182]` has magnitude
**95.42829414398788 m**. It is 4.571706 m below 100 m. Its cause has not been
established by per-point comparison to truth; a surface-point average is not
necessarily the spacecraft model origin.

### Dense Disparity - pending changes

- [Disparity element](elements/disparity.json) now runs
  [disparity_cli.cpp](cv-cli/cpp-disparity/disparity_cli.cpp), using StereoSGBM.
- Inputs: already-rectified equal-sized 8-bit images.
- Editable range, block size, uniqueness and speckle parameters.
- Existing `disparity` output remains an 8-bit visualization.
- New `data` text output contains row-major disparities in **pixels**,
  invalid values as null, dimensions, settings, and valid count.
- OpenCV fixed-point values are decoded by division by 16.
- Numeric data, not the visualization, must be used for reconstruction.
- The separate free-form **DISPARITY** toolbar dialog is still a placeholder;
  it does not execute the dense CLI.

### Stereo calibration and rectification - pending changes

Added under **Geometry & Calibration**:

- [Stereo Calibrate](elements/stereo_calibrate.json):
  no image input ports; configured left/right checkerboard folders processed
  as one batch. Pairing requires identical filenames.
  Defaults: 9x6 **inner corners**, 0.025 m squares, minimum 8 accepted pairs.
  Estimates K1/D1/K2/D2, then stereo R/T with intrinsics fixed.
  Output reports baseline, RMS pixels, accepted/rejected pairs.
- [Stereo Rectification](elements/stereo_rectify.json):
  optional connected calibration text or configured saved JSON file.
  Produces `rectification` JSON (Q/R1/R2/P1/P2/ROIs/metadata),
  `leftMaps`, and `rightMaps` OpenCV FileStorage JSON.
- [Remap](elements/remap.json) now has an optional `maps` text input.
  Connected maps override Map X; existing presets/files still work.
- Workflow planning honors `optional` inputs; UI labels them as optional.
- [workflow_args.js](workflow_args.js) supports
  `{in.maps|param.map_x}` and equivalent calibration-file fallback.
- Main checks authorized calibration folders and fallback calibration files.

Connections:

```text
Stereo Calibrate.calibration -> Stereo Rectification.calibration
Stereo Rectification.leftMaps  -> Left Remap.maps
Stereo Rectification.rightMaps -> Right Remap.maps
Left image  -> Left Remap.image  -> Disparity.left
Right image -> Right Remap.image -> Disparity.right
```

Calibration schema:

- `schemaVersion: 1`, `type: "stereo_calibration"`.
- `imageWidth`, `imageHeight`, `lengthUnits: "m"`.
- `cameraAxes: "x_right_y_down_z_forward"`.
- `transformConvention: "point_C2 = R * point_C1 + T"`.
- K1/K2/R: nested 3x3 arrays; D1/D2: flat five-coefficient arrays
  `[k1,k2,p1,p2,k3]`; T: nested **3x1** array.
- Right camera physically to the right of a parallel left camera means
  `T = [[-baseline],[0],[0]]`, not positive baseline.
- Q outputs meters in the **rectified left camera frame**.
- Current chain rejects vertical/reversed stereo because dense matching
  expects horizontal nonnegative left-minus-right disparity.
- Standard pinhole distortion only; fisheye and fixed pre-calibrated
  intrinsics for checkerboard calibration are not supported yet.
- Run calibration as a separate setup workflow: a no-input batch node in
  a multi-frame graph currently repeats once per frame.

Known synthetic geometry can bypass checkerboard calibration using the
documented calibration JSON. Do not pass Blender world poses directly.
Image resolution, pixel-center convention, camera axes, and relative transform
must be reconciled. Blender helpers use width/2,height/2 while nominal camera
profiles use (width-1)/2,(height-1)/2; verify before exporting calibration.

Detailed schema/examples: [stereo calibration README](cv-cli/cpp-stereo-calibration/README.md).

### CLI documentation - latest completed task

Every native CLI project now has a README covering purpose, arguments/defaults,
example usage, workflow support, and actual free-form toolbar availability.
Multi-executable projects have sections per tool.

Index: [cv-cli/README.md](cv-cli/README.md).
Coverage verified: **24 project READMEs**, **31 workflow CLI entries**,
**89 local links**. Documentation corrected Simple Stereo's native focal
default and fixed baseline-unit wording. No executable behavior changed in
the documentation task.

## Validation

Latest addition: **Dense Stereo** (`dense_stereo` / `dense_stereo_cli`) now
reconstructs numeric Disparity `data` using Stereo Rectification `rectification`.
Optional rectified-left mask selects the target. Outputs are positionEstimate
JSON (mean surface position, range/bearing, angles, counts and range statistics)
and points3d PLY in meters. Insufficient accepted points yield explicit
unavailable status and null aggregate measurements.
See [Dense Stereo README](cv-cli/cpp-dense-stereo/README.md).
Native build succeeded; latest focused suite passed **27 tests**, including
actual StereoSGBM/Q reconstruction of a 15 m plane and known 100 m reprojection.
Browser verified parameter saving.

Generated rectification maps already include undistortion: remove separate
Undistort before Remap when using these maps. Sparse Corners must run on the
rectified left image and connect keypoints to Simple Stereo.leftKeypoints.
Independent Physical Camera batches do not guarantee synchronized exposures.

- New native StereoSGBM and stereo calibration projects built successfully
  through VS Code CMake Tools.
- Latest combined stereo/shared-workflow suite: **39 passed, 0 failed**.
- Calibration tests generate perspective checkerboards, recover known
  baseline within tolerance, and exercise actual workflow execution.
- Q reconstructs a known 100 m point correctly.
- Generated maps were passed through existing Remap with exact identity
  pixel preservation for the ideal parallel case.
- Browser checks verified calibration/rectification dialogs save parameters
  and reject invalid alpha; Disparity dialog rejects invalid range settings.
- No reported editor errors for changed implementation files.
- README coverage/link check and `git diff --check` passed.

Focused test command, after building the native projects:

```sh
node --test cv-cli/test/stereo_calibration.test.mjs \
  cv-cli/test/disparity.test.mjs cv-cli/test/simple_stereo.test.mjs \
  palette_categories.test.js ui_view.test.js ui_view_text.test.js \
  splitter_text.test.js process_text.test.js view_helpers.test.js
```

The editor test runner did not discover these Node built-in tests; terminal
`node --test` was used. Native fixture generator is built with BUILD_TESTING.
Use VS Code CMake Tools for native builds. Its settings were temporarily
switched for the new projects and restored to:

```json
{
  "cmake.sourceDirectory": "${workspaceFolder}/cv-cli/cpp-usb-camera",
  "cmake.buildDirectory": "${workspaceFolder}/build/cpp-usb-camera"
}
```

## Beta preparation (0.9.0-beta.1) - pending changes

- Branded as **Orbital Eyes** (`package.json` name/productName/version,
  `app.setName`). DevTools open only with `npm run dev` / `--dev` /
  `ORBITAL_EYES_DEV=1`.
- Placeholder logo (satellite with eyes): `assets/logo.svg`, PNGs, and
  `build-resources/icon.icns`. Splash window (`splash.html`); main window
  1440x900, min 1024x640.
- About window (`about.html`/`about.js`): version, build date, OpenCV,
  Electron/Node, settings files, tool paths, built native tools.
  Help window (`help.html`/`help.js`/`markdown.js`) renders `help.md` and
  linked repository Markdown. App menu with Help (F1); nav-bar Help/About
  buttons; SVG nav icons; per-category palette icons (AI/ML uses a brain).
- `app.json` gained `cliDir`, `blenderPath`, `pythonPath`, `usbCameraCli`;
  a per-user `userData/app.json` overrides it. Blender paths are centralized.
  Missing native tools are reported as Plan problems.
- electron-builder: `npm run pack` / `npm run dist`; `asar` is disabled so
  CLIs and Blender scripts run from the bundle. Packaged app verified to
  launch and run a native CLI. Not signed or notarized yet.
- Tests: `npm test` runs all Node tests (118 passing); `beta_shell.test.js`
  covers the new shell pieces.
- Next iteration: ship 2-3 example workflows, then real logo/branding.
  Stereo Pose Estimator remains a stub until the CNN exists.

## Cross-platform build (macOS, Windows, Linux) - pending changes

- One CMake build for all tools: `cv-cli/CMakeLists.txt`, presets `vcpkg`
  (bundled, redistributable) and `system` (local OpenCV, not bundled) in
  `cv-cli/CMakePresets.json`. `cv-cli/vcpkg.json` pins OpenCV 4.10.0 at the
  vcpkg baseline `be1ae8e5`; contrib is deliberately omitted (it pulls hdf5,
  tesseract, curl and protobuf, and SURF needs nonfree), so `cpp-surf` is
  skipped in vcpkg builds. Release-only shared triplets are in
  `cv-cli/triplets/*-oe.cmake`.
- `npm run build:native` (`scripts/build-native.mjs`) configures, builds and
  installs into `native/` (`bin/`, `lib/`, `native-info.json`); it picks the
  triplet from platform/arch. `npm run smoke:native` runs nine tools on
  `img/one.png`. `prepack`/`predist` run `verify:native` (30+ tools required).
- On macOS the install re-signs ad hoc (install-time rpath edits break the
  linker signature). Verified: 33 tools, 17 dylibs in `native/lib`, rpath
  `@loader_path/../lib`, no Homebrew references, every file passes
  `codesign -v`.
- `native_tools.js` (pure, tested) resolves tools as `native/bin/<name>[.exe]`,
  then `cv-cli/cpp-*/build/`, then `build/Release/`; it also provides the
  per-OS Blender and Python defaults. `main.js` uses it for workflow steps,
  legacy actions, USB camera, the About tool list and the OpenCV version;
  `app.json` gained `nativeDir`.
- Tests resolve tools through `cv-cli/test/tools.mjs` (same order, plus the
  superbuild tree for `stereo_calibration_fixture`); the SURF test skips when
  no SURF tool exists. Verified with all per-project builds hidden: 125 pass,
  1 skipped.
- Packaging: `native/**/*` replaces the old per-project globs; Windows NSIS
  (`build-resources/icon.ico`), Linux AppImage + tar.gz; `dist:mac`,
  `dist:win`, `dist:linux`.
- CI: `.github/workflows/build.yml` builds, smoke-tests, tests and packages on
  macos-14, ubuntu-22.04 and windows-2022 with a cached vcpkg binary cache.
  Windows has not been run yet; expect first-run fixes (MSVC warnings or
  POSIX assumptions in tests).
- Docker: `docker/linux-build.Dockerfile` + `docker/linux-build.sh` build and
  package Linux from any host (see `docker/README.md`).

## Next work and cautions

1. **Dedicated robust Stereo Range & Bearing remains proposed.**
   Dense Stereo now implements mean visible-surface range/bearing, not a
   model-center or robust navigation estimator.
   Recommended ID/executable: `stereo_range_bearing` /
   `stereo_range_bearing_cli`. Inputs would be numeric disparity and matching
   rectified calibration/Q, with optional target mask/ROI.
   Outputs: representative position, range, bearing unit vector,
   azimuth/elevation, counts, range statistics, explicit status/frame/units.
   Visible-surface estimates must not be labeled spacecraft-center estimates.
   Point spread is not automatically navigation uncertainty.
2. Consider subpixel sparse NCC and confidence/consistency rejection,
   validated against known fractional shifts and depth.
3. Free-form DISPARITY toolbar execution still needs implementation.
4. Validate long-range stereo against actual per-point ground truth and
   distinguish depth, camera range, and model-origin range.
5. Preserve pending work; do not commit or revert unrelated changes.
   No commit was requested for the latest implementation/documentation tasks.
6. Historical fullscreen/retention/loop issues need fresh investigation before
   claiming they remain bugs; the old handoff was not reliable current evidence.

## Running and communication

Run `npm start` from the project root. Restart/reload Electron after changes;
installed element definitions may otherwise remain stale.

Use plain-text formulas and code-block matrices in chat. The user's chat
renderer did not display LaTeX reliably. Markdown preview extensions help
documents, not necessarily chat. Markdown Preview Enhanced and Markdown All
in One were suggested, but no extensions were installed by the assistant.

Earlier conversation details were summarized during context compaction.
This handoff records verified current work and important decisions so future
sessions do not rely on the obsolete initial snapshot.
