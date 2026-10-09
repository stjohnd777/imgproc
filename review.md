# Application understanding review

Updated October 8, 2026 against the current working tree on `main`.
Latest commit checked: `b92f2e2` (sparse stereo coordinate fix).
This document summarizes the current architecture and evidence from recent
implementation/validation; it is not a new exhaustive code or security audit.
Pending changes are included and are not all committed.

For operational details and continuation tasks, see [HANDOFF.md](HANDOFF.md).

The new **AI/ML** category contains a **Stereo Pose Estimator** scaffold.
Its [CLI](cv-cli/cpp-stereo-pose/README.md) is wired to stereo image inputs and
pose JSON output, with authorized model/metadata file parameters. It reports
explicit failure without writing a pose: ONNX Runtime inference and Python
training are not implemented.

## Purpose and current shape

**Orbital Eyes** is an Electron desktop workbench for image processing,
synthetic spacecraft imagery, and visual-navigation research for
rendezvous/proximity operations (RPO). Plain JavaScript provides the UI and
orchestration; standalone C++/OpenCV executables process artifact files.

Three complementary experiences are implemented:

1. **Image exploration:** inspect images and run individual toolbar operations.
2. **Workflow composition:** connect typed nodes, edit parameters, save/load
   workflow documents, and execute image sequences with retained artifacts.
3. **Scene Composer:** build static synthetic scenes with models/cameras,
   edit transforms, and generate Blender previews.

The intended navigation component would combine camera observations and GNC
estimates to produce range, bearing, and relative attitude. A cFS-independent
engine with a thin cFS adapter was discussed; application integration with
cFS is not implemented.

## Repository responsibilities

| Location | Responsibility |
|---|---|
| [main.js](main.js) | Electron lifecycle, IPC, authorized filesystem access, CLI declarations, workflow persistence/planning/execution |
| [preload.cjs](preload.cjs) | Renderer IPC bridge |
| [Data.js](Data.js) | Tab/sidebar/spec/workflow models and port compatibility |
| [Controller.js](Controller.js) | Coordinates models, views and processing; local and REST runner abstractions |
| [View.js](View.js) | DOM UI, graph canvas, parameter dialogs and artifact display |
| [index.html](index.html) | Application shell, styles, toolbar and initialization |
| [app.json](app.json) | Results directory, timeout, model and saved-scene directories |
| [elements/](elements/) | Installed workflow declarations, ports, parameters and execution mapping |
| [cv-cli/](cv-cli/) | Native C++17/OpenCV projects, tests and CLI documentation |
| [workflow_args.js](workflow_args.js) | Workflow positional argument expansion |
| [SynC/](SynC/) | Blender camera/scene generation, models, scenarios and validation |
| [scene_composer.js](scene_composer.js) | Three.js viewport and scene editing |
| [scene_composer_document.js](scene_composer_document.js) | Scene validation, transforms and camera aiming |
| [scene_composer_storage.js](scene_composer_storage.js) | Configured scene CRUD and GLB catalog |
| [surface.html](surface.html) | Separate image-intensity surface visualization |
| [cpp-lib/](cpp-lib/) | Separate native camera/calibration/domain/service direction; not the current Electron local backend |

## Processing boundary and UI

```text
View -> Controller -> LocalRunner -> preload IPC -> main -> native CLI
View <- Controller <- output artifact and processing information
```

Native processes receive argument arrays without a shell. Main reads installed
element definitions instead of trusting renderer-supplied executable mappings.
Selected files/folders require authorization; typing a path does not itself
grant access. These are application boundaries, not a claim of comprehensive
security auditing.

Toolbar image processing and workflow composition remain separate. Toolbar
previews generally do not replace the tab's processing input; explicit chains
belong in workflows. Fourier can open a generated-output tab.
The image-intensity surface view is not a metric depth reconstruction.

Schema-driven dialogs serve most toolbar actions and workflow nodes.
Camera profiles can fill relevant intrinsics/distortion parameters.
Process Text uses a multiline code editor.
The free-form **DISPARITY** dialog remains an unfinished preparation surface;
it is distinct from the functioning Disparity workflow element.

## Workflow data, persistence and execution

- Nodes identify installed elements and hold parameters, positions and ports.
  Workflow save/open rebuilds definitions from the installed catalog and
  validates document structure/parameters.
- File artifacts carry data between steps. Port types include `image`, `text`,
  `disparity`, `keypoints`, `matches`, and `pointcloud`.
  Disparity extends image; keypoints/matches extend text.
- One output can feed multiple consumers. Graph steps and branches execute
  sequentially in topological order for each frame.
- Planning checks structure, including required connections. Optional inputs
  may be disconnected and use configured file/preset fallbacks.
  A runnable plan is not proof that every native operation will succeed.
- Arguments support `{in.port}`, `{out.port}`, `{param.name}`,
  `{frame.index}`, and connected-input/configuration fallbacks such as
  `{in.maps|param.map_x}`.
- Single-image sources can repeat alongside sequences. Processing is paced
  by completion; late frames are reported.
- UIView/UIViewText display image/text artifacts, optionally reusing tabs.
  Splitters forward artifact paths without copying.
- Save sinks copy files. Changing an image sink extension does not itself
  re-encode the file; format conversion belongs upstream.
- Workflow persistence, latest-frame artifact actions, and Results management
  are implemented; the old review's claim that workflows could not save/load
  is obsolete.
- The editor supports multi-select (click modifiers and box), group drag,
  cut/copy/paste/duplicate (internal connections only, new IDs), Delete, and
  per-tab undo/redo. Selection is not undoable and does not mark the workflow
  modified; history is in memory only and is not saved with the workflow.

Batch stereo calibration is intended for a separate setup workflow. A
no-input calibration node in a multi-frame graph currently executes per frame,
so save and reuse calibration rather than recalibrating every mission image.

## Available capabilities and limitations

| Area | Current status |
|---|---|
| Sources | Single Image, Image Directory, synthetic sources and finite-batch Physical Camera execution |
| Legacy Camera | Generic Camera declaration still lacks execution mapping |
| Image processing | Filters, enhancement, geometry, segmentation, analysis and simulation CLIs |
| Features | SIFT, SURF, ORB, FAST, KAZE, BRISK and Corners emit previews and structured keypoint JSON |
| Descriptors | Detector CLIs do not currently export descriptor matrices |
| Utilities | Process Text, SplitterText, Splitter (2/3/4-way), image splitting, horizontal/vertical concatenation |
| Sparse stereo | Integer-centered NCC block matching, matches, 3D cloud and position mean |
| Dense stereo | StereoSGBM Disparity element with preview and numeric disparity data |
| Dense reconstruction | Dense Stereo consumes numeric disparity and matching Q, with optional mask; outputs PLY and mean surface position/range/bearing |
| Calibration | Paired-checkerboard Stereo Calibrate and Stereo Rectification with Q/maps |
| Scene Composer | GLB viewing/placement, poses/T, camera aiming, scene CRUD, Blender previews |
| Range & Bearing | Mean visible-surface range/bearing is implemented in Dense Stereo; dedicated robust target-center estimation is future work |
| Full target pose | Not established by averaging surface points; requires additional estimation |
| REST/cFS | Architectural direction, not the selected local processing path |

Precision is not uniform: older tools often load 8-bit color, while several
effects preserve unsigned 8/16-bit inputs. Consult individual tool documentation.
Process Text is synchronous JSON-only and intended for trusted scripts, not
a security sandbox.

## Stereo geometry and correctness

### Sparse matcher

[simple_stereo_cli.cpp](cv-cli/cpp-simple-stereo/simple_stereo_cli.cpp) performs
sparse block/template matching at supplied keypoints, not descriptor matching.
The fixed bug mixed fractional detector positions with integer patch centers.
Reported left coordinates, disparity, and XYZ now use consistent patch centers.
Zero disparity yields null 3D and contributes no finite point to the mean.

This fix does not implement subpixel sparse matching. Native fx defaults to
1000 px; the workflow supplies 3200 px. Baseline input is millimeters, while
exported point3d/PLY/position estimates use meters.

The previously supplied position magnitude remains **95.428294 m**.
That alone does not establish a depth algorithm error relative to a 100 m
model origin: matched surface points and the model origin are different
reference points. Per-point truth validation is still needed.

### Dense disparity

[Disparity](elements/disparity.json) runs StereoSGBM on already-rectified,
equal-sized 8-bit images. Its `data` output preserves numeric pixel disparity
and invalid nulls; `disparity` is a visualization, not measurement data.
OpenCV's fixed-point output is divided by 16. Fractional output resolution
is not a guarantee of subpixel accuracy.

### Calibration and rectification

[Stereo Calibrate](elements/stereo_calibrate.json) pairs folder images by
identical filename, detects checkerboards, estimates individual K/D, then
solves relative R/T with intrinsics fixed. It reports RMS and accepted/rejected
pairs. Defaults are 9x6 inner corners, 0.025 m square size, and eight accepted
pairs. Diverse poses and independent validation are essential.

[Stereo Rectification](elements/stereo_rectify.json) takes calibration JSON
and produces Q, R1/R2, P1/P2, valid ROIs and left/right map pairs.
Maps feed optional `maps` ports on [Remap](elements/remap.json), preserving
existing file/preset behavior when disconnected.

```text
Paired checkerboard folders -> Stereo Calibrate -> Stereo Rectification
Stereo Rectification.leftMaps  -> Left Remap.maps
Stereo Rectification.rightMaps -> Right Remap.maps
Left/Right rectified images -> Disparity -> numeric disparity
```

Calibration uses meters and OpenCV camera axes (right/down/forward).
`point_C2 = R * point_C1 + T`; T is a 3x1 vector, not a world pose.
Q reconstructs in the rectified left camera frame. Known synthetic geometry
can bypass checkerboard estimation using the documented calibration schema.
Current dense processing requires horizontal positive left-minus-right
disparity; reversed/vertical rigs are rejected.

Maps and Q must match the same image dimensions and rectification settings.
Do not directly mix Blender world poses or original intrinsics with rectified
image geometry. The rendering helpers' width/2 convention and nominal
profiles' (width-1)/2 convention require explicit reconciliation when exporting
synthetic calibration.

Full schema and examples:
[stereo calibration README](cv-cli/cpp-stereo-calibration/README.md).

[Dense Stereo](cv-cli/cpp-dense-stereo/README.md) now implements the reconstruction
stage. It uses Disparity `data`, Stereo Rectification `rectification`, and an
optional target mask. It excludes invalid/low disparity, invalid ROIs,
behind-camera geometry and excessive range; reports counts and unavailable
status when too few points remain. It outputs meter-valued PLY and mean
visible-surface position/range/bearing, not target attitude or model-center pose.
Latest focused suite: 27 passed, including an actual StereoSGBM/Q 15 m plane.
Generated maps already combine undistortion and rectification: raw physical
images should go directly to Remap, without a preceding Undistort.

## Scene Composer

The editor uses locally loaded Three.js/Draco GLB assets from the configured
model directory. It supports orbit/pan/zoom, gizmos, rigid local-to-world T,
scene JSON, undo/redo, lighting, and save/load/import/delete.
Aim at Target rotates a camera toward the model origin without moving it;
it does not create a persistent tracking constraint.

Blender remains the render authority; viewport materials are not guaranteed
to reproduce Blender output. Trajectory fields are preserved, but the initial
composer interaction is static. The inspector is resizable.
A known body ResizeObserver disposal issue remains to be addressed separately.

## Results, configuration and reproducibility

Current [app.json](app.json):

```json
{
  "resultsDir": "~/data/workflows",
  "toolTimeoutMs": 60000,
  "modelsDir": "SynC/models",
  "scenesDir": "~/data/workflows/scenes"
}
```

Results use producing-node/port filenames and typed extensions.
Run IDs contain timestamps plus UUIDs; the old second-resolution collision
claim no longer applies. Run artifacts persist; scratch is separate.
Retained files alone should not be described as a complete immutable
reproducibility package containing source imagery and all environment state.

## Documentation and validation evidence

[CLI reference](cv-cli/README.md) indexes all native tools. Each of the
24 project READMEs covers purpose, arguments/defaults, examples, workflow
support, and actual free-form toolbar availability. Multi-tool projects have
per-executable sections. Verified 31 workflow CLI entries and 89 local links.

Recent validation:

- Native dense disparity and stereo calibration projects built successfully.
- Combined focused stereo/shared-workflow suite: **39 passed, 0 failed**.
- Sparse regressions failed before the coordinate fix and passed afterward.
- Perspective checkerboard fixtures recovered the known baseline within
  tolerance and fed rectification through actual workflow execution.
- Known Q reconstructed a 100 m point correctly.
- Generated maps worked directly with Remap; ideal identity maps preserved
  pixels exactly.
- Browser checks verified parameter saving and invalid-setting rejection.
- Earlier Scene Composer checks exercised actual Electron storage and Blender
  rendering; these are prior evidence, not newly rerun in this document update.

Build native projects using VS Code CMake Tools. App execution is `npm start`.
Tests use Node's built-in runner; `npm test` remains a placeholder.
Latest targeted command:

```sh
node --test cv-cli/test/stereo_calibration.test.mjs \
  cv-cli/test/disparity.test.mjs cv-cli/test/simple_stereo.test.mjs \
  palette_categories.test.js ui_view.test.js ui_view_text.test.js \
  splitter_text.test.js process_text.test.js view_helpers.test.js
```

## Priorities and interpretation

1. Extend the implemented Dense Stereo mean surface range/bearing toward
   robust target estimation, with explicit geometry/reference-point semantics.
2. Distinguish visible-surface range from target-center range, and point spread
   from navigation uncertainty.
3. Evaluate subpixel sparse refinement and confidence rejection against
   known synthetic disparity/depth, not just visually plausible outputs.
4. Complete the separate free-form Disparity execution path if desired.
5. Preserve pending changes and validate unresolved historical issues before
   repeating old review findings as current facts.

The current application is a functioning research workbench, not yet a
validated flight-navigation estimator. Its file-based workflow architecture
is useful for independent comparison of correspondences, calibration,
reconstruction, and future navigation measurement extraction.
