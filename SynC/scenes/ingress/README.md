# Dynamic Ingress Simulation (`SynC/scenes/ingress`)

Simulates a spacecraft ingress (relative approach trajectory) towards a target satellite (**Cassini-Huygens**) from **100.0 m down to 10.0 m** in **0.5 m steps** (181 frames = 362 total stereo images).

---

## 1. Setup & Coordinate Frames

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

## 4. Configuration with `params.json`

The simulation is configured via `params.json`:

```json
{
  "name": "ingress",
  "target_model": "Cassini-Huygens (A).glb",
  "chase_model": "",
  "start": 100.0,
  "stop": 10.0,
  "increment": 0.5,
  "sun": {
    "azimuth_deg": 180.0,
    "elevation_deg": 30.0,
    "apparent_diameter_deg": 0.533,
    "energy": 5.0,
    "temperature_k": 5778.0
  },
  "camera": {
    "spec": "camera_spec/bfly_pge_13s2m_cs.json",
    "name": "Blackfly BFLY-PGE-13S2M-CS",
    "resolution": { "width": 1288, "height": 964 },
    "lens_focal_length_mm": 12.0,
    "sensor_size_mm": { "width": 4.83, "height": 3.615 },
    "baseline_mm": 120.0
  },
  "render": {
    "engine": "BLENDER_EEVEE_NEXT",
    "samples": 64,
    "color_mode": "RGB"
  }
}
```

- **Target model**: Any `.glb` located in `SynC/models/`.
- **Trajectory**: `start`, `stop`, `increment` in meters.
- **Sun Lighting**: Azimuth is measured from global `+Y` toward `+X`; cameras look along `+Y`, so `180` degrees places the Sun behind the camera. Elevation `30` degrees places it above the target. Workflow edits only affect images when **Re-render in Blender before running** is enabled; otherwise existing frames are reused.
- **Camera Selection**: Specify the camera directly or point `spec` to a project camera definition (e.g. `camera_spec/bfly_pge_13s2m_cs.json` for narrow FOV or `camera_spec/see3cam_cu30_chl_tc.json` for wide FOV).

---

## 5. How to Run

Navigate to the directory and run:

```bash
cd SynC/scenes/ingress

# Run using settings from params.json
./run.sh

# Or override specific parameters from CLI:
./run.sh --start 50 --stop 10 --increment 1.0 --azimuth 90 --elevation 15

# Dry run (regenerates ground_truth_trajectory.json without rendering):
./run.sh --dry-run
```

---

## 6. Integrating with the Workflow Editor

In the app, you can test this sequence directly with the workflow pipeline:
1. Add an **Image Directory** source node pointing to `SynC/scenes/ingress/left`.
2. Connect it to **Corners** $\rightarrow$ **Simple Stereo** along with a second **Image Directory** source pointing to `SynC/scenes/ingress/right`.
3. Set FPS to simulate real-time ingress processing.
