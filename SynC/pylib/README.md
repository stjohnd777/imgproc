# Shared SynC scene configuration and setup

For scene commands, outputs, and workflow integration, start with the
[SynC scene guide](../README.md). This document is the detailed schema and
library reference.

Static stereo and ingress use one schema (`schema_version: 1`):

- `scene_config.py`: JSON loading, supported-field validation, and application
  of camera optics profiles. It does not import Blender.
- `scene_setup.py`: Blender render/environment setup, hierarchy-preserving
  model import, physical camera creation, and single-camera rendering.
- `ingress_egress.py`: spatial trajectory primitives and object movement.
- `render_scene.py`: universal rendering, trajectory sampling, and metadata.
- `orbit.py`: rigid camera-rig circular motion with optional target tracking.

The universal renderer uses JSON to choose static views or sampled motion;
scene-local scripts provide compatibility entry points. Scene setup itself
does not execute motion. See the
[universal-renderer guide](../README.md#universal-renderer) for CLI examples.

## Schema v1

See complete examples in the
[static-pair defaults](../scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json)
and [ingress defaults](../scenes/ingress/params.json).

| Section | Fields and semantics |
| --- | --- |
| `scene` | `name`, `units: "meters"`, `world_frame`, `render` |
| `scene.world_frame` | `name: "world"`, `handedness: "right_handed"`, axes X right / Y forward / Z up |
| `scene.render` | Blender `engine`, `resolution_px: [width, height]`, optional `resolution_percentage` (1-100, default 100), `image_format`, `color_mode`, optional `color_depth` and `samples` |
| `camera_rig` | `name`, `cameras`; optionally `baseline_m`, `baseline_axis: "+X"`, `parallel_optical_axes` |
| Each camera | Unique `name`, `focal_length_mm`, `sensor_width_mm`, `sensor_height_mm`, `sensor_fit`, `pose`; optional `clip_start_m` / `clip_end_m` (defaults 0.1 / 2000) |
| `environment` | `background`, `sun`, optional `additional_lights`, `earth`, `moon`, `stars` |
| `background` | `color_rgb` (three nonnegative linear RGB values), `strength` |
| `sun` | `enabled`; when enabled, `direction`, `apparent_angular_diameter_deg`, `blender_energy`, `color_temperature_k` |
| Additional lights | `name`, optional `enabled`, `type: "SUN"`, `blender_energy`, `rotation_euler_rad`, optional `color_rgb` |
| `models` | Nonempty array of unique `name`, `file`, `pose` entries |
| `trajectory` | Optional; `type: "linear"`, `"piecewise_linear"`, or `"orbit"`, `frame: "world"`, positive `max_step_m`; model paths use `object`, orbit uses model `target` |
| Linear trajectory | `start_position_m`, `end_position_m` |
| Piecewise trajectory | `waypoints_m` (at least two positions) |
| Orbit trajectory | Model `target`; optional `radius_m` (initial rig-to-target distance), `axis_world` (default `[0, 0, 1]`), `start_angle_deg` (0), `sweep_angle_deg` (360), `track_target` (true) |
| `output` | Optional `prefix` (default `scene`), `camera_directories` (camera-name to folder-name mapping for motion), `log_filename` (default `render_manifest.json` for static or `ground_truth_trajectory.json` for motion) |

Every pose has `frame: "world"`, three-element `translation_m` and
`rotation_euler_rad`, and optional `rotation_order` (default `XYZ`).
Blender cameras look along local `-Z`, with local `+Y` up.
`build_scene(params, models_dir)` returns `(scene, cameras, models)`;
`cameras` follows configuration order and `models` maps configuration names
to Blender root objects. Model geometry is recentered at its world-space
bounding-box center under that root while retaining imported hierarchy.

Sun directions use `representation: "azimuth_elevation"`, `frame: "world"`,
`azimuth_zero_direction: "+Y"`, `azimuth_increases_toward: "+X"`,
`elevation_reference_plane: "XY"`, and
`vector_points: "scene_toward_sun"`. The renderer reverses that vector to
obtain incoming light. Temperature is applied when Blender supports it;
otherwise setup reports that the light remains white.

Supported image formats are PNG, JPEG, BMP, TIFF, and OPEN_EXR; use the
color mode/depth supported by Blender for the chosen format. `render_camera`
uses Blender's actual file extension. Render samples configure Cycles or
EEVEE's supported sample control; unavailable controls fail explicitly.
EEVEE identifier aliases are substituted with a printed notice.

Enabled Earth/Moon visibility or illumination, visible stars, unsupported
coordinate conventions, and unsupported trajectory types fail explicitly.
Spatial sampling currently has no timestamps, velocity, or exposure model.

`render_scene(params, output_dir, ...)` returns the metadata/frame log.
It renders each camera once without a trajectory, or each camera at each
trajectory sample. Linear samples are evenly spaced. Piecewise sampling
retains every corner and subdivides each nonzero segment independently;
frame `stepMeters` is the planned preceding path step and metadata
`trajectory.stepMeters` is the largest planned step. Coordinate precision
is limited by Blender's mathutils vectors.

For model paths, camera poses and model orientation stay fixed. For orbit,
the target pose stays fixed and the camera rig moves. The Sun stays fixed
in both cases. Output
paths use single filename components, and case-insensitive camera-folder
collisions are rejected. Compatibility wrappers can supply legacy output
names and require rectified disparity logging without constraining the
universal renderer's general camera support.

Frame logs contain `images` (camera name to relative path),
`cameraToWorld`, and `modelToWorld` matrices in Blender axes. A dry-run log
has `metadata.dry_run: true` and planned image paths. Eligible stereo runs
also log camera-forward depth and theoretical model-origin disparity.
Invalid disparity geometry is identified explicitly, not represented as a
fabricated disparity. Two motion folders named `left` and `right` also emit
the existing `leftImage` and `rightImage` fields.

## Camera-rig orbit API

`CameraRigOrbit(cameras, target_matrix, *, radius_m=None,
axis_world=(0, 0, 1), start_angle_deg=0, sweep_angle_deg=360,
track_target=True)` captures the cameras' world transforms once.
`position_at(t)` and `matrix_at(t)` are read-only calculations;
`apply(t)` moves every camera and returns the rig's world matrix.
Update the Blender view layer after applying a sample, as the universal
renderer does.

The virtual rig's origin is the camera-position centroid, and the first
camera's world rotation defines its initial orientation. Camera transforms
relative to that frame are preserved. The target transform's translation
defines a fixed center; later target movement is not automatically followed.
This moves configured cameras, not a vehicle object.

The orbit normal is normalized; the initial target-to-rig direction must
lie in its plane. Radius must be positive, cameras must be distinct, and
camera constraints or cameras parenting one another are unsupported.
Positive angles use the right-hand rule about the normal. Tracking points
rig local `-Z` at the target with local `+Y` along the orbit normal,
avoiding individual-camera toe-in. Disabling tracking retains the initial
world orientation. `t` is normalized angular progress, not simulation time.

Orbit sampling divides the swept arc into steps no greater than `max_step_m`,
including the endpoints; full-circle final poses repeat the starting pose.
Logs add `rigToWorld` and `rigCenterWorldMeters`; `positionWorldMeters` is
the rig center. Effective radius, axis, tracking, and total arc length are
recorded in trajectory metadata. World-Y ingress disparity is explicitly
unavailable for orbit; consumers can derive rig-frame geometry from logged
transforms. Stereo baseline and relative orientations remain rigid even
though their world directions change around the orbit.

## Validation

Standard-library schema tests run without Blender:

```bash
python -m unittest discover -s SynC/tests -p 'test_scene_schema.py'
```

The same suite includes Blender integration tests and tiny image renders.
Run it from the repository root using your Blender executable:

```bash
blender --background --python-exit-code 1 --python SynC/tests/test_scene_schema.py
```

Integration tests use temporary output directories; they do not replace
scene output images or trajectory logs.
