# Handoff

**Project:** `/Users/danielst.johnst.john/development/electron/hello-world`
**Branch:** `main` (last commit `4ef6628 init`; everything below is uncommitted)
**Platform:** macOS, Electron 44, Node 24, ESM (`"type": "module"`), Homebrew OpenCV 4.11 at `/opt/homebrew` (contrib + nonfree, so SURF works)

---

## Goal

An Electron desktop app for viewing images and running computer-vision processing, as a proof of concept for a robot's visual navigation. Plain JavaScript in an MVC structure, no frameworks. OpenCV work happens in small C++ command-line tools, one per algorithm, invoked per image.

The end goal is the **workflow graph**: drag elements onto a canvas, wire them together, and run the chain over a directory of frames as though a camera were feeding it. That now works end to end.

A REST/Docker (Crow C++) backend is planned later; `Controller.js` already has a `RestRunner` alongside `LocalRunner` for that reason.

---

## Architecture

| File | Role |
|---|---|
| `main.js` | Electron main process. Owns all filesystem and process access. |
| `preload.cjs` | contextBridge. The only route from page to main. |
| `Data.js` | Models: `TabModel`, `SideBarModel`, `ExplorerModel`, `SpecModel`, port types. |
| `View.js` | All DOM building and event wiring. |
| `Controller.js` | Coordinates model and view; `LocalRunner` / `RestRunner`. |
| `index.html` | Markup, CSS, and the setup script (`TOOLBAR_ACTIONS`). |
| `surface.html` / `surface-preload.cjs` | Separate 3D surface window and its own smaller bridge. |
| `app.json` | Settings: `resultsDir`, `toolTimeoutMs`. |
| `elements/` | One JSON per workflow element. **Untracked — add to git.** |
| `cv-cli/cpp-*/` | One C++ tool each (16 tools). |
| `cv-cli/common/cli_args.hpp` | Shared optional-argument parsing and range checking. |
| `design.md` | Full design notes; kept current. |

---

## Key decisions

**1. One parameter declaration drives everything.**
Each toolbar action's parameters are declared once in `CLI_ACTIONS` in `main.js` with type, label, default and range. That single declaration produces the dialog (the page fetches it via `window.vision.actions()`), validates the values, and fixes argument order. Adding a parameter is one line in `main.js`, one in the C++, one in the element file — no dialog code.

Types: `number`, `integer`, `odd` (OpenCV kernels), `boolean` (passed as `1`/`0`), `enum`.

**2. Workflow nodes reuse the same dialog.**
`View.showSchemaDialog` builds the form. `showActionDialog` (toolbar) and `showNodeParamsDialog` (node gear button) are thin callers. `elementParamSpecs` converts an element's `params` object into form specs. Difference: toolbar declarations come from `main.js` and values are remembered per action; node declarations come from the element file and values are stored on the node.

Three dialogs stay hand-written because their fields are conditional or sourced elsewhere: `STRETCH` (fields depend on mode), `UNDISTORT` (prefilled from a camera spec), `DISPARITY`.

**3. Workflow steps pass data as files.**
Every tool is already a process that reads a file and writes a file, so edges become paths. This also makes runs inspectable and comparable afterwards.

```
<resultsDir>/runs/<workflow>/<run>/frames/NNNN/NN_<node>__<port>.<ext>
<resultsDir>/scratch/session-<pid>/                      toolbar output
```

Files are named after the **producing** node and port, not the edge, because a node can have several outputs (SIFT writes `__keypoints.json` and `__preview.png`) and one output can feed several inputs. `NN` is execution order, so a frame folder reads top to bottom as the graph ran. Extensions come from port type (image/disparity → png, keypoints/matches → json, pointcloud → ply).

**4. Frames are paced by completion, not `setInterval`.**
A plain interval overlaps once a frame exceeds its slot, and tools take 40–500 ms. The runner waits out whatever remains of the slot after the frame finishes, and counts the frame **late** when nothing remains. The summary reports the late count.

**5. Runs are kept; only scratch is deleted on quit.**
Earlier the whole results folder was wiped on `will-quit`, which destroyed the record runs exist to provide.

**6. Security boundary.**
- `preload.cjs` exposes only `vision`, `explorer`, `specs`, `workflow`.
- `CLI_ACTIONS` is an allow-list; `execFile` with no shell.
- Every parameter is range-checked in main before becoming an argument.
- Element definitions are read from `elements/` **by main**, never accepted from the page — the page chooses *which* element, never what executes. The resolved binary must be inside `cv-cli/`.
- All paths checked against `allowedFolders`. **Choosing a folder in the system dialog is what grants access**, which is why folder and file parameters are read-only with a Browse button rather than typeable.

---

## What was built this session

**C++ (`cv-cli/`)**
- New tools: `median`, `gaussian`, `stretch`, `undistort`, `remap`, `convert`, `simple_stereo`.
- 12 existing tools gained their real OpenCV parameters (previously hardcoded): SURF, SIFT, ORB, FAST, KAZE, BRISK, Corners, Contours, Canny, Histogram, Sobel.
- New `common/cli_args.hpp` — shared parsing/range-checking; every CMakeLists gained an include path for it.
- `sift_cli` writes a keypoints JSON as argument 3 (pass `""` to skip).
- `stretch_cli` reads with `IMREAD_UNCHANGED`; every other tool uses `IMREAD_COLOR` and will silently crush 16-bit input to 8-bit.

**Renderer**
- Toolbar: `MEDIAN`, `GAUSSIAN`, `STRETCH`, `UNDISTORT`, `SURFACE` added.
- Schema-driven dialogs replaced the hand-written Threshold/Median/Gaussian ones.
- Workflow nodes: gear button → parameter dialog.
- Tab rename by double-click; workflow names kept unique (they become folder names).
- Status bar: **Plan run**, **Run**/**Stop**, live progress.
- Node execution visualizer: live cyan pulsing border/glow, illuminated header, and spinning gear icon on whichever node is actively processing a step.
- Completion alert: modal dialog on workflow finish/stop with frame counts, lateness, output path, and a **View Results** shortcut button.
- Results viewer: navigation ribbon icon (folder with graph) listing finished runs under `resultsDir` from `app.json`.
- Surface view: intensity as a 3D height field in a separate window, plain canvas 2D (no 3D library), painter's algorithm, viridis/grayscale/heat ramps, drag to rotate, shift-drag to pan, wheel to zoom.
- JSON Spec Editor Tab: Camera (and algorithm) specs open directly in editor tabs from the sidebar via open button, row double-click, or title click. Supports live JSON syntax checking, dirty indicators, 2-space Tab indent, format, revert, and disk saving with `Cmd+S` / `Ctrl+S` that immediately hot-reloads spec models across the application.

**Main**
- `prepareWorkflowRun` — topological sort, artifact paths, problem reporting, no execution.
- `runWorkflow` / `stopWorkflow` — frame loop, progress events (`started`, `step`, `frame`, `finished`, `failed`), one run at a time.
- Builtins: `dir_source`, `single_image`, `sync_camera_source`, `passthrough`, `save_to_dir`, `save_text_to_dir`, `save_pointcloud_to_dir`.
- Workflow documents: Open, Save, and Save As use versioned `navlib-workflow` JSON. Files contain node IDs/element IDs/params/positions and edges; ports are rebuilt from the current element catalog on open. Save As defaults to `resultsDir/workflows/`. Saved local paths do not grant access; opening warns when paths need to be reselected in node settings.
- `app.json` settings with `~` expansion and fallback.
- Folder/file choosers for workflow parameters.

**Elements** — one JSON per tool plus sources/sinks/flow, all with `exec` blocks. Includes text and point-cloud directory sinks.

**Stereo output** — `simple_stereo_cli` triangulates internally in millimeters, then writes the ASCII PLY cloud, detailed matches/points JSON, `positionEstimate` JSON, and preview position in meters. Matches JSON also retains explicit `point3d_mm` fields. `keypoints` and `matches` ports extend the `text` type so either can connect to the text directory sink.

**Synthetic lighting** — `sync_camera_source` forwards azimuth/elevation to Blender when it regenerates frames. If rendered frames already exist and the node's **Re-render in Blender before running** setting is off, the workflow reuses those files; changing lighting settings alone does not relight them. Default sun azimuth is now 180 degrees (camera side; cameras look along global +Y) and elevation is 30 degrees (above the target). Existing workflow nodes keep their saved values.

---

## Tests run

App-level checks were headless via Electron with a hidden `BrowserWindow`, driving the real UI (synthetic drag-and-drop, pointer drags between ports, dialog submits) and reading results from the DOM and disk. Throwaway scripts live in `/tmp` and are **not** part of the repo.

| Area | Result |
|---|---|
| All 19 toolbar actions with declared defaults | pass |
| Empty params fall back to defaults | pass |
| Out-of-range, wrong-type, injection (`"30; rm -rf /"`) | all rejected |
| Dialogs: fields, types, Defaults button, value memory | pass |
| All 23 element `exec` templates executed for real | pass |
| SIFT parameters take effect | `nfeatures` 0/50/200 → 4858/50/200 keypoints |
| Node gear dialogs (number, enum, camera, boolean, empty) | pass |
| Folder/file choosers, `createDirectory` for sink | pass |
| Unchosen folder refused | pass |
| Run: dir → stretch → canny → sink, 5 frames | 10 intermediates + 5 sink files |
| Frame order follows sorted filenames | proven with alternating distinct inputs |
| Stop mid-run; second concurrent run refused | pass |
| `app.json` missing / malformed / override | pass |
| Runs survive quit, scratch deleted | pass |
| Ingress frame 1 stereo scale: same 587 matches at `fx=1000` and `fx=3200`; mean Z changes from 29.5 m to 94.4 m against 100 m ground truth | pass; confirms the earlier 1000 px focal default was the dominant scale error |
| Workflow model/controller save flow: Save As, dirty tracking, Save, Open in new tab | pass with mocked IPC and a connected source-to-sink graph |

Serialized stereo coordinates use meters in a rectified camera frame: `X` is image-right, `Y` is image-down, and `Z` is forward. Internally the CLI computes millimeters because the baseline parameter is in mm. For the Blender ingress rig, forward `+Y` maps to stereo `+Z`; the scene origin target at 100 m should therefore be near `[0, 0, 100]` m (about `[0.06, 0, 100]` m from the left camera). The average of sparse feature positions is not guaranteed to be at the target origin because the spacecraft is rotated and detected features are not symmetrically distributed. Validate per-point errors against ground truth before treating the mean as the spacecraft center.

**Testing note:** `node --check` does **not** catch a missing closing brace in these ESM renderer files. Verify with `node --input-type=module -e "import('./View.js')"` *and* by loading `index.html` in a hidden window with `console-message` logged. A syntax error in `View.js` renders the whole UI blank.

---

## Unresolved issues

1. **`loop: true` on Image Directory does nothing.** Without a frame cap it would run forever. Needs either a max-frames parameter or an explicit loop-until-stopped mode.
2. **Runs accumulate indefinitely** under `~/data/navlib/runs`. No pruning or "open runs folder" button.
3. **16-bit input is degraded by every tool except `stretch`.** They use `IMREAD_COLOR`. Stretch first, or convert the others to `IMREAD_UNCHANGED`.
4. **`elements/` and the new `cv-cli` tools are untracked.** Needs `git add`. `review.md` is also untracked and unexamined.
5. **Legacy Camera Source and Disparity cannot run** in a workflow — no `exec`. `sync_camera_source` is the runnable synthetic stereo source; the Disparity tool is still not written.
6. **Only SIFT emits structured data.** Other detectors output an annotated preview image, so they are not usable as real feature sources downstream.
7. **Feature-detector elements were bulk-edited by script** (`/tmp/sync-elements.mjs`); parameter *order* matches each CLI but only the `exec` round-trip was verified, not each parameter's effect.
8. **`threshold.json` has a boolean `setBandValue`** but the tool wants `1`/`0`. The runner converts booleans; the toolbar path is separate and already correct.
9. **No CSP**; the page still uses an inline script (`index.html`). Moving it to `app.js` was discussed, not done.
10. **Surface view reads the displayed 8-bit image**, so raw 16-bit frames look flat. Stretch first.
11. **Gear replaced the element-kind icon** in node headers. Kind is still shown by colour/border.
12. **macOS fullscreen fix is unverified visually.** The surface window is no longer a child window (a child over a fullscreen parent blanks the Space on close). Space/compositing behaviour is not observable headlessly — `capturePage` renders offscreen and the window reports healthy while the screen is black. Needs a human to confirm.
13. **Docker `build.sh` failure** was never investigated.
14. **The user's `space/` stereo run has not been validated yet.** The 100 m check above used `SynC/scenes/ingress` frame 1 and nominal Blackfly intrinsics. Compare `space/` frame 1's saved matches/point cloud to its own camera settings and ground truth; do not infer correctness from the average alone.

---

## Next steps

1. **Validate the user's `space/` run** (issue 14): check saved `fx`, `fy`, baseline, image dimensions, disparity distribution, and compare individual reconstructed points with first-frame ground truth.
2. **Commit.** `elements/`, `cv-cli/common/`, the new tools, `app.json`, `surface.html`, `surface-preload.cjs`, and current SynC source/config files are untracked.
3. **Decide the `loop` semantics** (issue 1) — smallest gap between here and continuous running.
4. **Show run results in the UI.** Nothing currently opens a run's artifacts; the graph runs and the files appear, but you must look in Finder. A per-node preview thumbnail, or clicking a node to open its latest frame in a tab, is the obvious next feature.
5. **Per-node run state on the canvas** — idle/running/failed, and the failing step highlighted.
6. **16-bit handling** (issue 3) — decide whether tools read unchanged.
7. **Keypoints from the other detectors** (issue 6) if features are to flow between nodes.
8. **Disparity tool**, then wire the existing dialog to it.

---

## Running it

```bash
cd /Users/danielst.johnst.john/development/electron/hello-world
npm start                      # devtools open automatically

# build one tool
cmake -S cv-cli/cpp-canny -B cv-cli/cpp-canny/build -DCMAKE_BUILD_TYPE=Release
cmake --build cv-cli/cpp-canny/build

# watch a run
find ~/data/navlib/runs -type f | tail
```

**Note:** renderer edits need a reload (Cmd+R) or restart — Electron loads the JavaScript once at startup. Several "the button isn't there" moments this session were a stale window.

`cv-cli/cpp-sobel/build` was a stale CMake cache copied from another project and had to be deleted; if a tool refuses to configure, delete its `build/` first.
