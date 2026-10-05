# Dynamic Ingress Simulation (`SynC/scenes/ingress`)

Simulates a spacecraft ingress (relative approach trajectory) towards a target satellite (**Cassini-Huygens**) from **100.0 m down to 10.0 m** in **0.5 m steps** (181 frames = 362 total stereo images).

---

## 1. Setup & Coordinate Frames

Ingress/egress motion is sampled by the shared `SynC/pylib/ingress_egress.py`
`LinearSegment` and `PiecewiseLinearPath` helpers. A segment's normalized
parameter runs from 0 at its first world-space point to 1 at its second;
reverse endpoints for egress. Piecewise paths use normalized traveled
distance across their waypoints. Use `move_object_along_path` to place an
object at a sample. It can optionally aim supplied cameras at the target;
leave that option empty for a parallel, rectified stereo rig. Camera creation
in the POCs is shared through `SynC/pylib/camera.py`.

- **Camera Coordinate Frame**:
  - The stereo camera rig is located at the origin looking along global **$+Y$**, with **$+Z$** pointing up and **$+X$** pointing right.
  - Left Camera: $X = -60\,\text{mm}$
  - Right Camera: $X = +60\,\text{mm}$ (Baseline $B = 120\,\text{mm}$)
- **Target Satellite**:
  - Centered along the optical axis at $Y = d$, where $d \in [100.0\,\text{m}, 10.0\,\text{m}]$.
  - Relative attitude: Euler $(15^\circ, -30^\circ, 20^\circ)$ to present antennae, solar panels, and main body facets to the cameras.
- **Lighting**:
  - Directional Sun light ($5778\,\text{K}$ blackbody, angular diameter $0.533^\circ$) defaults to the camera side, slightly above the target, to illuminate its camera-facing surfaces.
  - Deep space background is pure black $(0, 0, 0)$.

---

## 2. Directory Structure

```
SynC/scenes/ingress/
  ├── build_ingress_scene.py       # Python script driving Blender API
  ├── run.sh                       # Executable shell runner
  ├── ingress_stereo.blend         # Generated Blender scene file
  ├── ground_truth_trajectory.json # Ground-truth distance, coordinates, & theoretical disparity
  ├── left/                        # Left camera rendered sequence
  │     ├── frame_0001.png (100.0m)
  │     ├── frame_0002.png (99.5m)
  │     └── ... (up to frame_0181.png at 10.0m)
  └── right/                       # Right camera rendered sequence
        ├── frame_0001.png
        ├── frame_0002.png
        └── ...
```

---

## 3. Disparity Dynamics

Given:
- Focal length: $f_x = 3200\,\text{px}$
- Baseline: $B = 120\,\text{mm}$

The theoretical disparity for the center of the target as a function of range $Z$ is:
$$d(Z) = \frac{f_x \cdot B}{Z} = \frac{3200 \times 120}{Z\,\text{(in mm)}} = \frac{384}{Z\,\text{(in meters)}}$$

| Range ($Z$) | Theoretical Disparity ($d$) | Image Scale / Visual Appearance |
|---|---|---|
| **$100.0\,\text{m}$** | **$3.84\,\text{px}$** | Small target, sub-pixel feature tracking test |
| **$50.0\,\text{m}$** | **$7.68\,\text{px}$** | High confidence corner detection |
| **$30.0\,\text{m}$** | **$12.80\,\text{px}$** | Detailed dish, thruster and foil features |
| **$20.0\,\text{m}$** | **$19.20\,\text{px}$** | Prominent structure across field of view |
| **$10.0\,\text{m}$** | **$38.40\,\text{px}$** | Close-proximity, wide disparity search window |

---

## 4. Shared scene configuration

[params.json](./params.json) now uses the same `schema_version: 1` scene
format as the static Cassini stereo-pair builder. Both drivers use
[scene_config.py](../../pylib/scene_config.py) for loading/validation and
[scene_setup.py](../../pylib/scene_setup.py) for cameras, model import,
lighting, and render setup. See the
[shared schema reference](../../pylib/README.md).

The common sections are `scene`, `camera_rig`, `environment`, and `models`.
Ingress adds this `trajectory` section:

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

The target model moves while the cameras stay fixed and parallel. The
trajectory identifies the model by name, not its asset filename. It overrides
that model's translation at each sample while retaining its orientation.
`max_step_m` is a maximum spatial step; samples are evenly spaced and include
both endpoints. A non-divisible segment uses smaller steps. Reverse endpoints
for egress; equal endpoints produce one stereo pair.

Positions and baseline use meters, lens/sensor sizes use millimeters, and
Euler rotations use radians. The old flat JSON layout is no longer accepted;
the existing `--start`, `--stop`, `--increment`, `--target-model`, `--azimuth`,
and `--elevation` CLI/workflow overrides remain supported. `--start` and
`--stop` replace the endpoints' world Y coordinates, retaining X/Z;
`--increment` sets `max_step_m`.

- **Target model**: Set the named model's `file`, relative to `SynC/models/`.
  Missing files fail explicitly; there is no substitute spacecraft.
- **Sun**: Configure `environment.sun`. Azimuth is measured from `+Y` toward
  `+X`; 180 degrees places the Sun behind the cameras. Blender energy is
  render tuning, not calibrated irradiance. Unsupported temperature controls
  print a warning and leave the Sun white.
- **Camera selection**: Define both cameras in `camera_rig.cameras`, or use
  `--camera-spec` to override both cameras' optics and the render resolution
  from a project camera profile. Explicit camera poses/baseline are retained.
- **Render**: `scene.render.samples` and `color_depth` are now applied.
  Resolution percentage is preserved and accounted for in the disparity log.
  EEVEE identifier substitution is reported for Blender-version compatibility.
- **Ground truth**: Existing frame fields are retained. `distanceMeters`
  means camera-forward depth, not Euclidean range. The theoretical disparity
  is for the model-root origin; it is not a per-pixel disparity map.
  The log also records the full effective `scene_params`.

The trajectory can have arbitrary X/Z coordinates, but this stereo driver
currently requires matching HORIZONTAL cameras looking along world `+Y`
with `+Z` up and trajectory endpoints in front of them. Orbit and timed-motion
types are future extensions; unsupported trajectory types fail explicitly.

---

## 5. How to Run

Navigate to the directory and run:

```bash
cd SynC/scenes/ingress

# Run using settings from params.json
./run.sh

# Use an alternate scene configuration (now honored by the builder):
./run.sh --params /absolute/path/to/scene.json

# Override optics using a camera profile:
./run.sh --camera-spec camera_spec/see3cam_cu30_chl_tc.json

# Or override specific parameters from CLI:
./run.sh --start 50 --stop 10 --increment 1.0 --azimuth 90 --elevation 15

# Dry run (regenerates ground_truth_trajectory.json without rendering):
./run.sh --dry-run
```

The runner propagates Blender Python failures with a nonzero exit status.
Dry runs still build/import the scene and save the blend file and trajectory
log, but do not render images.

---

## 6. Integrating with the Workflow Editor

In the app, you can test this sequence directly with the workflow pipeline:
1. Add an **Image Directory** source node pointing to `SynC/scenes/ingress/left`.
2. Connect it to **Corners** $\rightarrow$ **Simple Stereo** along with a second **Image Directory** source pointing to `SynC/scenes/ingress/right`.
3. Set FPS to simulate real-time ingress processing.

Workflow range, target, Sun, and camera-profile settings are translated into
the shared schema by the ingress driver. Enable **Re-render in Blender before
running** to apply changes; otherwise existing frames are reused.
