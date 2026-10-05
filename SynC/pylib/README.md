# Shared SynC scene configuration and setup

Static stereo and ingress use one schema (`schema_version: 1`):

- `scene_config.py`: JSON loading, supported-field validation, and application
  of camera optics profiles. It does not import Blender.
- `scene_setup.py`: Blender render/environment setup, hierarchy-preserving
  model import, physical camera creation, and single-camera rendering.
- `ingress_egress.py`: spatial trajectory primitives and object movement.

The drivers decide whether to render a static pair or sample a trajectory.
Scene setup does not execute motion.

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
| `trajectory` | Optional; `type: "linear"`, model `object`, `frame: "world"`, `start_position_m`, `end_position_m`, positive `max_step_m` |

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
An orbit type can be added to trajectory validation and path construction
later without changing the common camera/model/environment sections.
Spatial sampling currently has no timestamps, velocity, or exposure model.

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
