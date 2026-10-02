# Application understanding review

Reviewed September 30, 2026 against the current working tree, including its uncommitted changes. This is a source-level understanding document for validation before adding functionality. No application code was changed, and the GUI, native binaries, and test suites were not run for this review.

## Purpose and current shape

The application is a desktop workspace for exploring computer vision operations on images and assembling those operations into visual processing workflows. Electron provides the interface and orchestration; standalone C++ programs use OpenCV to process images. Files are the current data exchange mechanism between processing steps.

There are two complementary experiences:

1. **Image exploration:** open images, compare them in editor groups, adjust operation parameters, and inspect processed previews.
2. **Workflow construction and execution:** connect typed source, transform, and sink nodes, configure their parameters, inspect an execution plan, and process image sequences while retaining intermediate results.

A separate `cpp-lib/` project establishes a longer-term camera, calibration, bearing, stereo, and attitude library/service direction. It is not the backend currently used by the Electron application's local processing path.

## Repository responsibilities

| Location | Current responsibility |
| --- | --- |
| `package.json`, `main.sh` | Electron launch configuration; JavaScript uses ES modules. `npm start` launches Electron. |
| `main.js` | Window lifecycle, IPC handlers, file dialogs and access checks, specification loading, toolbar action declarations, native process execution, workflow planning/execution, and result storage. |
| `preload.cjs` | Narrow renderer bridge exposing `vision`, `explorer`, `specs`, and `workflow` APIs through Electron IPC. |
| `index.html` | Application shell, CSS, toolbar action list, and renderer initialization. Starts with the two bundled images and `LocalRunner`. |
| `Data.js` | In-memory models for tabs, editor groups, sidebar, file explorer, specification trees, and workflow graphs; also defines port compatibility. |
| `Controller.js` | Coordinates user actions, model changes, rendering, processing requests, and workflow progress. Contains `LocalRunner` and an unused-by-default `RestRunner`. |
| `View.js` | DOM rendering and interaction: tabs, resizing and dragging, explorer/spec trees, image display, workflow canvas and wires, and parameter dialogs. |
| `surface.html`, `surface-preload.cjs` | Separate intensity-surface visualization window, using a 2D canvas to draw a projected surface. |
| `elements/*.json` | Workflow element catalog: identity, role/category, ports, parameters, and executable or built-in execution mapping. |
| `camera_spec/`, `algo_spec/` | JSON reference data displayed in the sidebar; camera data also supplies relevant dialog values. Algorithm specifications are not executable workflows. |
| `cv-cli/` | Independently built C++17/OpenCV command-line tools, each with its own CMake project. Shared optional-argument helpers live in `cv-cli/common/cli_args.hpp`. |
| `cpp-lib/` | Separate CMake project with common camera/calibration code, domain libraries, examples, Crow servers, and GTest tests. |
| `app.json` | Results directory and native-tool timeout settings. |
| `design.md` | Architectural intent and implementation notes, with some older sections that no longer match the code. |

## Process boundary and image exploration

The normal call chain is:

```text
View → Controller → LocalRunner → preload IPC → main.js → C++ CLI
View ← Controller ← image data URL, output path, and timing ← main.js
```

The renderer uses plain JavaScript and DOM APIs, with no frontend framework. Native execution uses `execFile` with argument arrays, rather than shell command strings. There is no native Node addon or persistent C++ worker in this path: each operation launches a separate executable.

Image tabs distinguish the display URL (`src`) from the file to process (`path`). Most toolbar actions set a temporary `resultSrc` preview on the existing tab. They do **not** replace its input path: clicking another operation processes the original tab input, not the preceding preview. Explicit operation chaining belongs to the workflow graph. Fourier is a special case that opens a new tab backed by its generated output file.

The UI supports opening image folders, recursive browsing, multiple side-by-side editor groups, tab movement/splitting/renaming, zoom, reset, parameter dialogs, errors, and processing timing. Camera and algorithm JSON can be inspected as expandable trees. The 2-/3-/6-DoF and Settings activity buttons are presentational placeholders rather than completed tools.

Toolbar declarations in `main.js` drive most parameter dialogs and validate toolbar arguments. Stretch, Undistort, and Disparity have specialized dialogs. `SURFACE` opens a separate visualization of the tab's file; it uses browser-decoded pixels rather than native high-bit-depth measurements.

## Workflow data and execution

A workflow is an in-memory tab containing `graph: { nodes, edges }`. Nodes carry their element ID, display metadata, position, parameter values, and copied port definitions. Edges identify producer and consumer nodes and named ports. The copied definitions preserve drawing information, while the main process reloads the element catalog to determine execution behavior.

The editor supports adding, moving, configuring, and removing nodes; connecting and removing wires; naming workflows; planning; running; and stopping. There is no implemented workflow save/load or session restoration.

Port types are `image`, `disparity`, `keypoints`, `matches`, and `pointcloud`, with `any` treated as a wildcard. `disparity` extends `image`. The model rejects self-connections, cycles, duplicate edges, and incompatible types. Outputs can feed multiple consumers; ordinary inputs accept one producer, while sink inputs permit multiple producers in the editor.

Execution proceeds as follows:

1. The planner checks for an empty graph, cycles, and unconnected inputs, then creates a topological step order and prospective artifact paths. A successful plan also creates its run directory.
2. The main process loads trusted execution definitions from `elements/` and resolves source files.
3. Each frame runs every step sequentially in topological order. Graph branches are currently executed sequentially too.
4. CLI argument templates substitute `{in.port}`, `{out.port}`, and `{param.name}`. Output files become downstream inputs.
5. Progress events report frame and step timing. The runner waits out any remaining frame interval and counts frames exceeding that interval as late.
6. Stop requests take effect between frames; they do not immediately terminate the current native process or remaining steps of that frame.

Directory sources use supported images directly inside the selected directory, sorted in natural filename order. Multiple directories are paired **by index**, and the shortest directory determines the default frame count. Single-image sources repeat alongside a directory, or produce one frame when used alone. The first source with a truthy `fps` supplies the pacing value. The UI does not supply `maxFrames`, so the current loop option does not cause continuous looping.

Source nodes forward original file paths. Splitter forwards the same input path to both outputs without copying. Save to Directory copies the selected incoming file. CLI transforms write intermediate files.

## Available processing versus placeholders

| Area | Source-level status |
| --- | --- |
| Sources | Single Image and Image Directory have built-in execution; Camera has a definition but no capture implementation. |
| Filters | Canny, Sobel, Threshold, Contours, Gaussian, Median, and Stretch have CLI implementations and element definitions. |
| Features | SURF, SIFT, ORB, FAST, KAZE, BRISK, and Corners have CLI implementations. The toolbar label `URF` maps to SURF. |
| Structured features | SIFT can write keypoint JSON plus an annotated preview. Other feature tools currently emit previews only. SIFT exports detected keypoints, not descriptor vectors. |
| Analysis | Fourier produces a spectrum image; Histogram produces a chart image. Surface is a separate renderer visualization. |
| Geometry | Undistort has an executable. Disparity has a setup dialog and element definition, but local stereo execution explicitly throws an unimplemented error and the element has no execution mapping. |
| Flow/output | Splitter and Save to Directory have built-in execution. |
| Future data types | Matches and point clouds have type/extension declarations, but no implemented producing/consuming element pipeline. Telemetry ports are modeled visually, with no concrete catalog outputs or runner implementation. |
| Remote execution | `RestRunner` sketches multipart HTTP uploads, but is not selected at startup; existing Crow routes provide health/hello endpoints rather than the processing API it expects. |

Most tools read images in 8-bit color or grayscale. Stretch explicitly reads unchanged input, including 16-bit images, and maps it into an 8-bit output. This is not yet a general pipeline that preserves original precision through every transform. Image-tab `pixelType` is a placeholder, not measured file metadata.

## Results and reproducibility

`app.json` currently specifies `resultsDir: "~/data/navlib"` and `toolTimeoutMs: 60000`. Relative result paths resolve from the application directory; missing or malformed settings fall back to defaults.

```text
<resultsDir>/
  scratch/session-<pid>/                    toolbar outputs
  runs/<workflow-slug>/<timestamp>/
    frames/0001/01_<node>__<port>.<ext>      generated step outputs
```

Workflow outputs are retained; the current session's scratch directory is removed on normal app quit. Image/disparity ports use PNG filenames, keypoints/matches use JSON, and point clouds use PLY.

The retained files help inspection, but a run is not yet a fully reproducible snapshot: no graph/parameter manifest is written, original source files are not copied, and passthrough outputs are not materialized at the planner's advertised paths.

## Separate C++ library direction

`cpp-lib/common` contains substantive camera math and calibration support: camera intrinsics, distortion, rigid poses, projection, checkerboard geometry, mono/stereo calibration, and undistort/rectify maps. Camera and calibration tests cover real behavior.

The bearing, stereo, and attitude domain entry points currently return hello-world placeholder results. Their Crow servers expose corresponding health/hello routes. Those domain and server tests are mostly scaffold tests. The Docker files describe a development environment for this library/service direction; they are not required by the current local Electron-to-CLI call chain.

## Gaps and discrepancies to keep in view

These observations come from reading the code, not from reproducing failures in the GUI.

| Observation | Consequence |
| --- | --- |
| Sink inputs accept multiple edges, but `prepareWorkflowRun` uses `edges.find` for each input. | Only the first producer is passed to execution; a sink does not yet collect all connected streams. |
| Save to Directory uses `copyFile`; `fmt` only changes the extension. | Selecting JPG for PNG input does not encode JPEG. Repeated runs with the same sink name/frame can overwrite destination files. |
| Run IDs have second-level timestamp precision. | Runs or plans for the same workflow within one second can share a directory; uniqueness is not guaranteed. |
| Planning checks graph structure only partially. | A plan may be marked runnable despite unsupported elements, missing executables, unset source/destination paths, or invalid parameters. |
| Toolbar and workflow parameters use separate declarations and validation paths. | Toolbar validation uses `CLI_ACTIONS`; workflow arguments are substituted directly, with substantial validation left to the CLI. The workflow runner does not fully validate against the element parameter schema. |
| Nodes retain copied ports but execution definitions are reloaded. | Editing the catalog can leave existing nodes out of sync with the executable's expected ports/defaults. |
| Filesystem allow-list checks use lexical paths, not resolved real paths. | They provide a boundary for normal use, but should not be described as complete symlink-aware containment. |
| The main-process planner trusts much of the submitted graph. | Editor connection checks are not equivalent to comprehensive IPC-side graph validation. |
| Early `design.md` sections call parameter editing and running unbuilt. | Those features are implemented. Older claims about filename pairing and workflow schema validation also exceed current behavior. |

Other existing development limitations include the missing Content Security Policy, automatically opened DevTools, and unused `uuid.js`. The design notes mention stale Sobel build output and a failed Docker build; their current runtime status was not independently verified.

## Build and validation baseline

Electron launches with `npm start` or `./main.sh` after dependencies are installed. Each native tool is built independently, for example:

```sh
cmake -S cv-cli/cpp-canny -B cv-cli/cpp-canny/build
cmake --build cv-cli/cpp-canny/build
```

The application expects executables under `cv-cli/cpp-<name>/build/<name>_cli`. SURF requires OpenCV contrib with nonfree support. There is no root npm script orchestrating all CLI builds, and `npm test` is currently a deliberately failing placeholder. The separate C++ library has CMake/GTest infrastructure. VS Code has a combined main/renderer debugging configuration.

For this review I inspected the application models, controller, view, IPC/execution paths, element catalog, representative native implementations, C++ library structure, build configuration, and design notes. Runtime correctness and whether existing binaries match current source remain unverified.

## Understanding to validate before new functionality

My working understanding is that image exploration should remain a quick way to inspect individual operations, while workflows provide explicit composition and inspectable runs. Element definitions are the main extension point for graph capabilities, and local C++/OpenCV execution is the current operating backend.

The decisions most likely to affect upcoming work are:

1. Should toolbar operations continue to use the original image, or should users be able to promote a preview into a new processing input?
2. Should directory streams pair by sorted position, exact filename, or recorded timestamps?
3. Should multi-input sinks save every connected stream, as the current editor permits?
4. Is the next priority workflow reliability/persistence, additional vision operations, camera/stereo support, or the library/service integration?
5. Which outputs need scientific fidelity: original bit depth, structured features/descriptors, calibration data, or fully reproducible run records?

These are validation points, not proposed implementation commitments. No new functionality is included in this review.
