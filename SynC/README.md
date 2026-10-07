# SynC: Synthetic Scene Generation

SynC uses Blender and its Python API (`bpy`) to generate scenes for visual
navigation, stereo vision, simulation, and future training-data workflows.
This guide is the shared entry point for the static stereo and ingress
examples. Their configuration and Blender setup use the same library.

## Contents

- [Architecture](#architecture)
- [Coordinates and camera conventions](#coordinates-and-camera-conventions)
- [Shared scene configuration](#shared-scene-configuration)
- [Lighting and environment](#lighting-and-environment)
- [Universal renderer](#universal-renderer)
- [Static stereo pair](#static-stereo-pair)
- [Ingress and egress](#ingress-and-egress)
- [Diagonal linear motion](#diagonal-linear-motion)
- [Camera-rig orbit](#camera-rig-orbit)
- [Workflow integration](#workflow-integration)
- [Validation](#validation)
- [Limitations and future extensions](#limitations-and-future-extensions)

## Architecture

- [pylib/](./pylib/) contains reusable camera, configuration, scene setup,
  and motion helpers.
- [models/](./models/) contains model assets.
- [scenes/](./scenes/) contains scene drivers, their JSON defaults, runners,
  and generated outputs.
- [tests/](./tests/) contains schema and Blender integration tests.

Both scene scripts delegate rendering to
[render_scene.py](./pylib/render_scene.py), the universal JSON-driven driver.
It uses [scene_config.py](./pylib/scene_config.py) for loading and validation
and [scene_setup.py](./pylib/scene_setup.py) for render settings, environment,
model import, and camera creation. JSON determines whether to render static
views or sample a trajectory. The scene scripts preserve their existing
commands, overrides, output names, and stereo-specific checks.

[camera.py](./pylib/camera.py) provides camera creation from physical
lens/sensor dimensions or supported K/T calibration inputs.
[camera_look_at.py](./pylib/camera_look_at.py) aims a camera at a target
transform's origin. [ingress_egress.py](./pylib/ingress_egress.py) contains
linear and piecewise-linear motion helpers. Camera tracking is optional;
the stereo examples keep their optical axes parallel.
[orbit.py](./pylib/orbit.py) moves and optionally aims the camera rig as
one rigid body around a fixed model.

## Coordinates and camera conventions

- Positions, model dimensions, clipping distances, and stereo baseline use
  meters. Lens focal length and sensor dimensions use millimeters.
- The world frame is right-handed: `+X` right, `+Y` forward, `+Z` up.
- Object poses use `pose.translation_m` and `pose.rotation_euler_rad`.
  Euler angles are radians; the examples use `XYZ` order.
- A Blender camera looks along local `-Z`, with local `+Y` up. Rotation
  `[1.5707963267948966, 0.0, 0.0]` points it along world `+Y`, with `+Z` up.

The default stereo rig places the left camera at `[-0.06, 0, 0]` and the
right camera at `[0.06, 0, 0]`: a 0.12 m baseline along world `+X`.
The cameras have parallel optical axes, a 12 mm lens, a
4.83 mm by 3.615 mm sensor, and 1288 by 964 pixel output.

Configuration stores one canonical pose rather than duplicating it as a
`T` matrix. When deriving a transform for downstream use, state its direction
(object-to-world or world-to-camera) and whether camera axes follow Blender
or OpenCV conventions.

## Shared scene configuration

Both examples load a neighboring `params.json` by default and accept
`--params PATH` for an alternate file. JSON is input data, not Python:
use numeric values and arrays rather than expressions such as
`math.radians(90)`.

The shared schema has these sections:

| Section | Purpose |
| --- | --- |
| `schema_version` | Version of the configuration layout; currently `1` |
| `scene` | Name, units, world frame, and render settings |
| `camera_rig` | Camera optics, poses, and stereo geometry |
| `environment` | Background, Sun, additional lights, and reserved celestial options |
| `models` | Named model assets and world poses |
| `trajectory` | Optional motion description, executed by a trajectory driver |
| `output` | Optional filename prefix, camera-directory mapping, and log filename |

Use the [schema and library reference](./pylib/README.md) for field details.
Complete defaults are available for the
[static pair](./scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json)
and [ingress](./scenes/ingress/params.json).

Models specify `file` relative to [models/](./models/). Missing assets fail
explicitly; the shared setup does not substitute another spacecraft.
Imported geometry is recentered under a named model root while preserving
its hierarchy.

Render settings include engine, resolution, resolution percentage, image
format, and color mode, with optional sample count and color depth.
Output extensions follow the selected format. Resolution percentage is
preserved and included in ingress disparity calculations.

The runners locate Blender at the standard macOS application path or fall
back to `blender` on `PATH`. They propagate Python failures as a nonzero exit
status. Either EEVEE identifier (`BLENDER_EEVEE` or `BLENDER_EEVEE_NEXT`) is
accepted, with a notice when setup substitutes the installed version's
identifier. Other unavailable engines fail explicitly.

## Lighting and environment

The Sun uses azimuth/elevation in the world frame:

- Azimuth starts at `+Y` and increases toward `+X`.
- Elevation is measured above the `XY` plane.
- The configured vector points from the scene toward the Sun.
  Blender receives the opposite vector, representing incoming light.

The default azimuth of 180 degrees puts the Sun behind the cameras;
30 degrees elevation places it above the target. The default apparent
angular diameter is 0.533 degrees, and the requested color temperature is
5778 K. On Blender versions without Sun temperature controls, setup reports
the unsupported setting and leaves the Sun white.

`blender_energy` is renderer tuning, not calibrated physical irradiance.
The static example includes a dim background and an artificial fill light.
Ingress uses a black background without an additional fill light.

Earth and Moon have separate visibility and illumination flags, allowing
future implementations to control each independently. They are not yet
modeled. Stars will require a catalog and exposure/camera-response model,
not simply an increase in world-background brightness.

## Diagonal linear motion

The [linear motion scene](./scenes/linear_motion/README.md) uses one fixed
Blackfly camera while Cassini enters through the upper-left corner, crosses
the center at a constant 100 m depth, and exits through the lower-right.
Its [JSON](./scenes/linear_motion/params.json) uses the existing linear
trajectory schema; no new motion implementation is needed.

```sh
cd SynC/scenes/linear_motion
./run.sh
```

Defaults produce 131 ordered 1288 x 964 PNG images plus ground-truth transforms
under `output/`. Video encoding and automatic frame delay are future tasks.

## Universal renderer

Run from the repository root using Blender, not a standalone Python
interpreter:

```bash
blender --background --python-exit-code 1 \
  --python SynC/pylib/render_scene.py -- \
  --params SynC/scenes/ingress/params.json \
  --output-dir /absolute/path/to/output
```

Use `/Applications/Blender.app/Contents/MacOS/Blender` on macOS if Blender
is not on `PATH`. Arguments for the Python script follow Blender's `--`.
`--output-dir` defaults to the parameter file's directory, and model assets
default to `SynC/models/`. `--models-dir` can select another asset directory.

- **No trajectory:** render once for every entry in `camera_rig.cameras`.
  One camera produces one image; two produce a pair; more produce multiple
  views. For a single-camera configuration, remove stereo-specific
  `baseline_m`, `baseline_axis`, and `parallel_optical_axes` declarations,
  and remove output directory mappings for cameras you removed.
- **Linear trajectory:** sample the named model's path for ingress or egress,
  rendering all cameras at each sample.
- **Piecewise-linear trajectory:** sample a polyline, including every waypoint,
  suitable for an initial polygonal approximation of an orbit.
- **Orbit trajectory:** move the rigid camera rig in a circle around a fixed
  target, with optional rig-center tracking (default enabled).
- **Lighting:** consume the configured Sun angles. `--azimuth` and
  `--elevation` can override an enabled Sun for a run. These are separate
  configurations/runs, not an automatic lighting sweep.
- **Optics:** `--camera-spec` applies a project camera profile.
- **Dry run:** `--dry-run` saves the initial scene and metadata, but no images.

The universal renderer does not require a rectified stereo rig. Cameras
keep their configured world poses during model-path motion; moving models
keep their configured orientations. Orbit instead moves all cameras as one
rig while the target stays fixed, optionally pointing the rig at the target.

Output can be described in JSON:

```json
"output": {
  "prefix": "ingress_stereo",
  "camera_directories": {
    "Camera_Left": "left",
    "Camera_Right": "right"
  },
  "log_filename": "ground_truth_trajectory.json"
}
```

Without output settings, the prefix is `scene`. Static image names are
`<prefix>_<lowercase-camera-name>.<extension>` and the log is
`render_manifest.json`. Motion images are
`<camera-name>/frame_0001.<extension>` and the log is
`ground_truth_trajectory.json`; `camera_directories` overrides folder names.
The blend file is `<prefix>.blend`, saved at the initial pose. Existing
files with the same output names may be overwritten; use a separate output
directory for each configuration.

Logs include effective configuration, per-frame image paths, and Blender
camera-to-world and model-to-world matrices. Dry-run image paths describe
planned outputs rather than files that were rendered.
Theoretical disparity is included only for supported rectified model-path
motion and a model origin in front of the cameras. Orbit does not use the
world-Y ingress disparity formula. The log explicitly records when disparity
is unavailable.

## Static stereo pair

[cassini-stereo-pair.py](./scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/cassini-stereo-pair.py)
renders one fixed left/right pair of Cassini at world position `[0, 30, 0]`.
It does not execute ingress or other motion and rejects configurations
containing a `trajectory` section.

From the repository root:

```bash
cd SynC/scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm
./run.sh

# Use another static scene configuration:
./run.sh --params /absolute/path/to/scene.json
```

Default outputs in that scene directory are:

- `cassini-stereo-pair.blend`
- `cassini-stereo-pair_blackfly_left.png`
- `cassini-stereo-pair_blackfly_right.png`

These image names reflect the default PNG format.

## Ingress and egress

[build_ingress_scene.py](./scenes/ingress/build_ingress_scene.py) moves the
target while keeping the stereo rig fixed. The default Cassini trajectory
runs from 100 m to 10 m along world `+Y`, with a maximum step of 0.5 m:
**181 stereo pairs, or 362 images**. The model attitude is
`[15, -30, 20]` degrees expressed as radians in the configuration.

The `trajectory` section is:

```json
{
  "type": "linear",
  "object": "cassini",
  "frame": "world",
  "start_position_m": [0.0, 100.0, 0.0],
  "end_position_m": [0.0, 10.0, 0.0],
  "max_step_m": 0.5
}
```

`object` names a configured model, not an asset file. Each sample replaces
the model-root translation while retaining orientation. Both endpoints are
included, with evenly spaced samples. `max_step_m` is a maximum: a segment
whose length is not divisible by it uses smaller steps. Reverse endpoints
for egress; equal endpoints produce one pair.

For a piecewise path, replace the linear trajectory with:

```json
"trajectory": {
  "type": "piecewise_linear",
  "object": "cassini",
  "frame": "world",
  "waypoints_m": [
    [0.0, 30.0, 0.0],
    [5.0, 30.0, 0.0],
    [5.0, 35.0, 0.0],
    [0.0, 30.0, 0.0]
  ],
  "max_step_m": 0.5
}
```

This is a closed polygonal path, not an analytic orbit. Every corner is
included, and each segment is sampled evenly with a step no greater than
`max_step_m` (subject to Blender coordinate precision). Duplicate waypoints
do not introduce extra stationary frames. Actual steps may differ between
segments: frame `stepMeters` records the step from the previous sample,
and metadata `stepMeters` is the largest planned step.

From the repository root:

```bash
cd SynC/scenes/ingress
./run.sh

# Alternate schema-v1 scene:
./run.sh --params /absolute/path/to/scene.json

# Override both cameras' optics and render resolution:
./run.sh --camera-spec camera_spec/see3cam_cu30_chl_tc.json

# Existing range and Sun overrides:
./run.sh --start 50 --stop 10 --increment 1.0 --azimuth 90 --elevation 15

# Build/save the scene and trajectory log, without rendering:
./run.sh --dry-run
```

The old flat ingress JSON layout is no longer accepted. Existing CLI
overrides remain supported:

- `--start` / `--stop` replace endpoint world Y coordinates, retaining X/Z.
  They require a linear trajectory; edit waypoints in JSON for piecewise paths.
- `--increment` sets `max_step_m`.
- `--target-model` overrides the moving model's asset filename.
- `--azimuth` / `--elevation` override Sun angles in degrees.
- `--camera-spec` applies a project camera profile while retaining camera
  poses and baseline. Relative profile paths are resolved from the repository
  root, not the scene directory.

Generated output layout, using default PNG settings:

```text
scenes/ingress/
  ingress_stereo.blend
  ground_truth_trajectory.json
  left/
    frame_0001.png
    ...
    frame_0181.png
  right/
    frame_0001.png
    ...
    frame_0181.png
```

### Ground truth and disparity

The trajectory log records frame numbers, world positions, camera-forward
depth, theoretical model-origin disparity, and relative image paths.
Metadata includes the full effective `scene_params`, sample count, requested
maximum step, and actual step. Camera/model world transforms and per-camera
image mappings are also recorded.

`distanceMeters` means camera-forward depth, not Euclidean range.
`theoreticalCenterDisparityPx` refers to the model-root origin; it is not a
per-pixel disparity map.

For the default full-resolution rig, `fx = 3200` pixels and `B = 0.12` m.
The theoretical disparity is `d = fx * B / Z = 384 / Z`, with `Z` in meters:

| Camera-forward depth | Theoretical disparity |
| --- | --- |
| 100 m | 3.84 px |
| 50 m | 7.68 px |
| 30 m | 12.80 px |
| 20 m | 19.20 px |
| 10 m | 38.40 px |

The trajectory may vary in X/Z, but this driver currently requires matching
HORIZONTAL cameras looking along world `+Y` with `+Z` up, a parallel stereo
rig, and trajectory endpoints in front of the cameras.

## Camera-rig orbit

Use the universal renderer with an orbit trajectory. Unlike ingress,
**orbit moves the cameras, not the target**:

```json
"trajectory": {
  "type": "orbit",
  "target": "cassini",
  "frame": "world",
  "radius_m": 30.0,
  "axis_world": [0.0, 0.0, 1.0],
  "start_angle_deg": 0.0,
  "sweep_angle_deg": 360.0,
  "max_step_m": 0.5,
  "track_target": true
}
```

Replace the trajectory in a scene configuration (or add it to a static
configuration), then run:

```bash
blender --background --python-exit-code 1 \
  --python SynC/pylib/render_scene.py -- \
  --params /absolute/path/to/orbit-scene.json \
  --output-dir /absolute/path/to/orbit-output
```

The existing static and ingress wrappers retain their original purposes and
reject orbit; use the universal entry point.

- `target` names a model root; its world-transform origin is the orbit center.
  The model stays at its configured pose.
- The initial rig center is the centroid of camera world positions. The
  initial rig orientation is the first camera's world rotation.
- `radius_m` is the rig-center distance from the target. When omitted, it
  defaults to the initial centroid-to-target distance.
- `axis_world` is the orbit-plane normal (default world `+Z`). It is normalized.
  The initial target-to-rig vector must be perpendicular to that normal;
  inconsistent planes fail explicitly rather than projecting silently.
- Angle zero uses the initial target-to-rig direction. `start_angle_deg`
  offsets it; positive sweeps follow the right-hand rule about `axis_world`.
  Use a negative sweep for the opposite direction, or a partial sweep for an
  arc. A full turn includes the initial position again as its final sample.
- `max_step_m` limits **arc length** between samples, not chord length.
  Samples are evenly spaced in angle and include both endpoints. A zero
  sweep produces one set of views.
- `track_target` defaults to **true**. The rig's local `-Z` points at the
  target and local `+Y` follows the orbit normal. Relative camera transforms
  are retained, so parallel stereo cameras stay parallel: there is no toe-in.
- With `track_target: false`, the rig retains its initial world orientation
  while its center travels around the target.

The current rig is a virtual reference frame applied to the configured
cameras; no vehicle mesh is moved. Direct API use is available through
`CameraRigOrbit(cameras, target_matrix, track_target=True, ...)` and
`apply(t)` for normalized angular progress `t` in `[0, 1]`. Keep the
controller instance across samples so all transforms derive from the same
captured initial rig.

Orbit logs include `rigToWorld`, `rigCenterWorldMeters`, individual camera
transforms, fixed model transforms, effective radius/normal/tracking, and
planned arc steps. For orbit, `positionWorldMeters` means the rig center
rather than the model position. This is geometric circular motion, not
orbital mechanics or a timed vehicle simulation.

## Workflow integration

### Synthetic Scene: JSON-driven single image output

The **Synthetic Scene** source uses the universal renderer directly, rather
than a scene-local script. Connect its fixed **image** output to UIView,
Distort Image, Add Noise, or other processing nodes. The existing **Synthetic
Camera** stereo source and its left/right outputs remain unchanged.

Open the node's parameter dialog:

1. Browse for a schema-v1 scene JSON or use the default Cassini static scene.
   **Load file (replace edits)** explicitly reloads the file.
2. Select the **Output camera** from the JSON's `camera_rig.cameras`.
3. Edit Sun `azimuth_deg`/`elevation_deg` and each model's name/file.
   Model filenames resolve under `SynC/models`; authorized absolute asset
   paths are also supported. Renaming a model updates matching trajectory
   `object`/`target` references. Angle fields are disabled when the Sun
   direction is not represented as azimuth/elevation.
4. Expand **Advanced JSON** to edit the complete configuration, including
   camera optics/poses, rig constraints, model poses, render settings,
   environment and trajectory. **Apply JSON to fields** synchronizes the
   simple controls; Save also applies pending JSON edits. Adding/removing
   cameras or models is currently an advanced JSON operation.
5. Save the node. The edited JSON snapshot and camera selection are stored
   in the workflow; the original scene file is never overwritten.

The dialog checks JSON syntax, schema version, unique names and the selected
camera. Blender's shared validator checks the complete scene schema at run
time; invalid geometry/settings fail explicitly. Use PNG output for viewing.
K/optics and image resolution must remain consistent; edits are not calibrated
or automatically reconciled with stereo baseline constraints.

Each run renders fresh images into a unique source folder under that workflow
run, retaining the effective `params.json`, `.blend` scene, render manifest
and camera images. Blender is required; source rendering has a five-minute
timeout. The full camera rig is rendered to preserve rig/orbit geometry, but
only the selected camera's images feed the node's single output.

A static configuration emits one image (repeated when paired with a longer
source). A configured linear, piecewise-linear, or orbit trajectory emits the
selected camera's sequence in manifest order. Playback FPS controls workflow
playback, not rendering or physical motion. Changing camera selection does
not change the node's ports.

### Synthetic Camera: existing stereo ingress source

The app's **Synthetic Camera** source can stream the generated left/right
sequences. Range, target, Sun, and camera-profile settings are passed through
to the ingress driver. Enable **Re-render in Blender before running** to
apply changes; otherwise existing images are reused.

Alternatively, use **Image Directory** sources for the generated
[left/](./scenes/ingress/left/) and [right/](./scenes/ingress/right/) folders
and connect them to the Corners / Simple Stereo pipeline.
Playback FPS controls streaming, not the trajectory's physical speed:
current samples have no simulation timestamps.

For controlled image degradation, insert **Distort Image** and **Add Noise**
between a synthetic source and processing:

```text
Synthetic Camera -> Distort Image -> Add Noise -> Undistort -> Processing
```

Distort Image uses the same K and five distortion coefficients as Undistort.
Selecting a camera profile fills the editable parameters in either node;
the values must match the image resolution. Add Noise defaults to zero-mean
Gaussian noise with sigma 5 intensity levels on the 0-255 scale and seed 0.
The workflow supplies a per-frame index for repeatable but different patterns
across frames; use different seeds on left/right branches. Both effects
preserve image dimensions and support 8-bit/16-bit inputs.
See [image effects](../cv-cli/cpp-image-effects/README.md) for build
prerequisites, CLI parameters, border behavior, and simulation limitations.

To view any pipeline image in the application, connect it to the **UIView**
sink under **Sinks & Viewers**. It has one image input, no output ports, and no
native build dependency. **Reuse preview tab** is enabled by default: each
sink updates its own image tab in the workflow's editor group, including
across repeated runs. Closing that tab causes the next frame to create it
again. Disable the option to open separate tabs for different image paths.
Manual artifact opening still selects an already-open image by path. The sink
does not copy or save another image; use Save to Directory for persistence.
Separate-tab mode currently has no tab-count limit.
Final-frame artifacts also arrive in the workflow completion result, so
UIView does not depend on progress-event delivery for a fast single-frame
run. Receiving both messages opens the image only once.
Branch an image output to UIView and other processing nodes to inspect an
intermediate result without changing the pipeline.

### Viewing and workflow navigation

The palette groups elements by task: **Sources**, **Image Enhancement**,
**Geometry & Calibration**, **Segmentation & Edges**, **Features**,
**Stereo & 3D**, **Analysis**, **Simulation**, **Utilities**, and
**Sinks & Viewers**. These groups only affect navigation; element IDs, ports,
parameters, and saved workflow execution are unchanged. Custom categories
remain visible; older `filter` and `flow` categories are displayed under
Image Enhancement and Utilities, respectively.
Each category heading shows its element count and a collapse/expand twisty.
Click the heading, or focus it and press Enter/Space, to toggle the group.
All groups start expanded; choices are retained during the application session,
including tab/sidebar changes and element reloads, but reset on app restart.

**Image Enhancement** includes **Bilateral Filter** (edge-preserving
denoising) and **CLAHE** (local luminance contrast enhancement).
**Morphology** (erode/dilate/open/close/gradient) is under **Segmentation & Edges**.
Distort Image and Add Noise are under Simulation; Undistort and Remap are
under Geometry & Calibration. Convert and Splitter are under Utilities.
The three new filters are built with the
`image-effects` native project and use the same image input/output workflow
ports. See [filter parameters and image-depth support](../cv-cli/cpp-image-effects/README.md#bilateral-filter).

**Image Diff** under **Analysis** accepts two image inputs (`img0`, `img1`)
and outputs `diff`, the absolute grayscale/color pixel difference.
Inputs must have matching dimensions, bit depth, and channel count; 8/16-bit
grayscale, RGB, and RGBA are supported. RGBA ignores input alpha and emits
opaque alpha for visibility. It uses the `image-effects` native project.
Connect its output to UIView for inspection or Threshold/Morphology for a
change mask. The element is stateless: it does not retain the previous camera
frame. Use separate t0/t1 images; feeding the same frame into both ports gives
black. See [Image Diff](../cv-cli/cpp-image-effects/README.md#image-diff).

**SplitterText** under **Utilities** passes one `text` input to two `text`
outputs, `a` and `b`, using the same built-in passthrough as the image Splitter.
It accepts text and derived `keypoints`/`matches` outputs, forwards the original
file without parsing or copying it, and has no parameters or CLI dependency.
Use it to branch a detector's JSON into separate Process Text computations or
viewers. Like the image Splitter, it is optional: one output can already feed
multiple inputs directly.

**Process Text** under **Utilities** is a built-in JavaScript JSON transform,
not a CLI. Connect a detector's `keypoints` output (or another JSON-bearing
`text`/`matches` output) to its `text` input. In the parameter dialog, edit or
paste `function process(objIn) { /* transform parsed JSON */ return objOut; }`.
Its `text` output is a new JSON file per frame, compatible with another
Process Text, UIViewText, or a Text Directory Sink. The function is saved
with the workflow and runs in fresh state on every frame.

The default function accepts the full Corners document (`objIn.keypoints`)
or a point array and returns `count`, `mean: { u, v }`, and
`boundingBox: { minU, minV, maxU, maxV, width, height }`. Coordinates retain
the input's pixel conventions; width/height are coordinate spans, not
inclusive pixel counts. Empty arrays return count zero and null statistics.
For a different computation, replace the default function. For identity,
use `function process(objIn) { return objIn; }`.

Functions must return JSON values (plain objects, arrays, finite numbers,
strings, booleans, or null). Invalid JSON, syntax/runtime errors, missing
returns, circular references, non-JSON values, and Promises fail the run
with a console error. Async/await is not supported in this initial version.
Execution runs in a separate worker with a 1-second wall-clock limit
(including worker startup), a 128 MB worker heap limit, 100 KB source limit,
and 5 MB input/output limits. No imports, Node file APIs, network APIs, or
timers are supplied. This is **not a security sandbox**: only run scripts
and workflows you trust.

**UIViewText** under Sinks & Viewers accepts a `text` input, including derived
`keypoints` and `matches` ports. It opens the file as read-only UTF-8 text
in the workflow's editor group; JSON remains text rather than requiring a
particular JSON structure. Reuse preview tab is enabled by default, with
one tab per sink across frames/runs. Disable it for separate file tabs.
Text previews are limited to 5 MB and do not create another file copy.
For example, connect Simple Stereo's matches or positionEstimate output,
or a detector's keypoints output, to UIViewText.

Each tab has a collapsible **Console** at the bottom. Workflow logs remain
on the workflow tab even when UIView selects an image tab. Toolbar operations
log to the image tab that initiated them. Local CLI/Blender stdout and stderr
stream while the process runs, with tool labels, timestamps, exit status and
elapsed time. stderr alone is not treated as failure. REST operations report
request completion/errors but cannot expose remote process streams.

Expand Console and drag its top divider to resize it. **Clear** discards
displayed history without stopping the operation; **Copy** copies all retained
text and reports clipboard success/failure. **Follow output** auto-scrolls;
scroll upward to pause, then check Follow output to resume. Logs are plain
text, retained in memory per tab up to 200,000 characters; older output is
explicitly marked as discarded. Failures expand the initiating console;
successful operations preserve its collapsed state. Logs are not yet
persisted/exported and closing a tab discards its history.

- **Fit Image** shrinks a large image to fit its editor pane without
  upscaling small images. Percentage/plus/minus controls return to manual
  zoom; 100% restores actual pixel size.
- **Fit Workflow** scales the graph to show all current nodes. The workflow
  **100%** button restores normal scale. Connections, node dragging and
  element drops use the scaled coordinates without changing saved positions.
- Nodes show compact parameter summaries below their ports. Hover over the
  summary for the complete text; Synthetic Scene includes its JSON filename,
  selected camera and configured Sun angles. Open the configuration dialog
  to edit values. These summaries do not replace full validation.

## Validation

Run the schema tests from the repository root:

```bash
python -m unittest discover -s SynC/tests -p 'test_scene_schema.py'
```

To include Blender scene setup, CLI, sampling, and small-render tests:

```bash
blender --background --python-exit-code 1 --python SynC/tests/test_scene_schema.py
```

On macOS, use `/Applications/Blender.app/Contents/MacOS/Blender` if Blender
is not on `PATH`. Integration tests use temporary output directories rather
than replacing scene images or logs.

## Limitations and future extensions

- JSON trajectories support `linear`, `piecewise_linear`, and circular
  camera-rig `orbit`. Elliptical paths, orbital dynamics, timed motion, and
  moving-target tracking are future extensions.
- Spatial samples do not yet define velocity, timestamps, exposure, or a
  calibrated sensor-response model.
- Enabled Earth/Moon visibility or illumination and visible stars fail
  explicitly until implemented. Future ephemeris integration should specify
  time, observer state, and coordinate frame.
- Rendering and theoretical disparity are useful test inputs, not a claim
  of calibrated physical or sensor accuracy.

New trajectory types can extend motion validation and path construction
without changing the common camera, model, or environment sections. Keep the
[library reference](./pylib/README.md) authoritative for detailed fields and
this guide authoritative for scene usage.
