# Simple Stereo CLI (`simple_stereo_cli`)

Sparse feature-based stereo matching and 3D point triangulation for horizontally rectified stereo image pairs. For complete step-by-step instructions on calibrating physical cameras and computing rectification maps, see [CALIBRATION.md](CALIBRATION.md).

## Application integration and example

Workflow: [Simple Stereo](../../elements/simple_stereo.json), under Stereo & 3D.
Inputs are left/right rectified images and left keypoints JSON; outputs are
preview, matches, points3d, and positionEstimate.
Free-form toolbar: **not available**. The DISPARITY button does not run this CLI.
Build and positional conventions: [CLI reference](../README.md).

Example from the repository root, using a 120 mm baseline and 3200 px focal lengths:

```sh
./cv-cli/cpp-simple-stereo/build/simple_stereo_cli \
  left.png right.png left.keypoints.json preview.png matches.json points.ply \
  64 4 0 0.6 120 3200 3200 643.5 481.5 position.json
```

Supply your measured rectified intrinsics rather than assuming these example
values. Native CLI fx defaults to **1000**, whereas the workflow defaults to
**3200**; native fy defaults to the chosen fx. Images are loaded as 8-bit color.

---

## 1. Overview & Conceptual Architecture

In a calibrated binocular stereo system, matching every individual pixel (dense disparity) is computationally expensive and prone to noise in low-texture regions.

**Sparse Stereo** matches only salient feature points (corners, keypoints) detected on the left image across to the right image. Because both images are horizontally rectified (via `undistort` + `remap`), corresponding epipolar lines are collinear and parallel to image scanlines.

```
Left Stream:   Camera L ---> Undistort L ---> Remap L (Rectify) ---+
                                                                   |
                                          +------------------------+
                                          |
                                          v
                                    Keypoint Detector (Corners / SIFT / ORB)
                                          |
                   [Left Image]           | [Left Keypoints JSON]
                        |                 |
                        v                 v
Right Stream:  Camera R ---> Undistort R ---> Remap R ---> [Simple Stereo]
                                  [Right Image]                     |
                                                                    +---> preview (PNG)
                                                                    +---> matches (JSON)
                                                                    +---> points3d (PLY)
```

---

## 2. Epipolar Geometry & 1D Template Matching

### 1D Search Constraint
Because of horizontal rectification:
- For any point $(u_L, v_L)$ in the left image, the corresponding point in the right image $(u_R, v_R)$ must lie on the exact same scanline:
  $$v_R \approx v_L$$
- Because the right camera is displaced horizontally to the right (+X in the camera frame), the physical scene point appears shifted to the left in the right sensor coordinate frame:
  $$u_R \le u_L$$
  $$\text{Disparity } d = u_L - u_R \ge 0$$

### Normalized Cross-Correlation (NCC)
For each detected feature $(u_L, v_L)$:
1. A square patch of dimensions $(2 \cdot \text{patchRadius} + 1) \times (2 \cdot \text{patchRadius} + 1)$ is sampled around $(u_L, v_L)$ from the left grayscale image.
2. A search strip along row $v_L$ (with vertical tolerance $\pm v_{\text{tolerance}}$) is extracted from the right image across horizontal range $[u_L - \text{maxDisparity}, u_L]$.
3. `cv::matchTemplate(..., cv::TM_CCOEFF_NORMED)` computes normalized correlation scores $\in [-1.0, 1.0]$:
   $$R(x, y) = \frac{\sum_{x',y'} (T'(x',y') \cdot I'(x+x', y+y'))}{\sqrt{\sum_{x',y'} T'(x',y')^2 \cdot \sum_{x',y'} I'(x+x', y+y')^2}}$$
4. The candidate with maximum correlation score $R_{\text{max}} \ge \text{minCorrelation}$ is accepted as the matching point $(u_R, v_R)$.

Matching is integer-pixel only: input keypoint coordinates are rounded to the
nearest pixel before extracting the left patch. Reported left/right match
coordinates, disparity, preview markers, and triangulation all use the actual
integer patch centers consistently. `leftId` retains the link to the original
detector keypoint. Fractional detector coordinates do not provide subpixel
disparity precision. Identical-image matches have zero disparity and null 3D
coordinates; they are excluded from the point cloud and position estimate.

---

## 3. Triangulation (2D Disparity to 3D Metric Space)

For each accepted match with non-zero disparity ($d = u_L - u_R > 0$):

Given:
- Baseline $B$ in millimeters (distance between optical centers)
- Rectified camera focal length $f_x, f_y$ in pixels
- Principal point $(c_x, c_y)$ in pixels

The 3D coordinate $[X, Y, Z]^T$ in the left camera coordinate frame is:

$$Z = \frac{f_x \cdot B}{d}$$

$$X = \frac{(u_L - c_x) \cdot Z}{f_x} = \frac{(u_L - c_x) \cdot B}{d}$$

$$Y = \frac{(v_L - c_y) \cdot Z}{f_y} = \frac{(v_L - c_y) \cdot B \cdot (f_x / f_y)}{d}$$

- If baseline $B$ is specified in millimeters ($\text{mm}$), $X, Y, Z$ are in millimeters.
- This CLI always expects `baselineMm` in millimeters; do not pass meters.
  Exported `point3d`, PLY, and position estimates are converted to meters;
  `point3d_mm` retains millimeters.

---

## 4. CLI Invocation & Arguments

```bash
simple_stereo_cli <imageL> <imageR> <leftKeypointsJson> <outPreview> <outMatchesJson> <outPoints3d> \
                  [maxDisparity] [patchRadius] [vTolerance] [minCorrelation] [baselineMm] [fx] [fy] [cx] [cy] [outPositionEstimateJson]
```

### Positional Arguments

| Index | Argument | Type | Description |
|---|---|---|---|
| `1` | `imageL` | Path | Rectified left camera image (`.png`, `.jpg`, `.bmp`, `.webp`). |
| `2` | `imageR` | Path | Rectified right camera image (same resolution as `imageL`). |
| `3` | `leftKeypointsJson` | Path | Input JSON with detected left keypoints (from `corners_cli`, `sift_cli`, `orb_cli`, etc.). |
| `4` | `outPreview` | Path | Output image file (`.png`) displaying matched points and disparity vectors. |
| `5` | `outMatchesJson` | Path | Output JSON file containing 2D correspondences, disparity, and 3D points. |
| `6` | `outPoints3d` | Path | Output 3D point cloud file (`.ply`) in standard ASCII format. |
| `16` | `outPositionEstimateJson` | Path | Optional JSON summary containing the arithmetic mean and point list; defaults to a sibling `.position_estimate.json` file. |

### Optional Tuning Parameters

| Index | Parameter | Default | Allowed Range | Description |
|---|---|---|---|---|
| `7` | `maxDisparity` | `64` | `1 .. 1000` | Maximum pixel search range ($d_{\text{max}} = u_L - u_R$). |
| `8` | `patchRadius` | `4` | `1 .. 32` | Half-width of correlation window (patch size = $2r+1$, default $9\times 9$). |
| `9` | `vTolerance` | `1.0` | `0.0 .. 10.0` | Vertical tolerance band in pixels ($\pm v_{\text{tol}}$) to handle minor calibration imperfections. |
| `10` | `minCorrelation` | `0.60` | `-1.0 .. 1.0` | Minimum normalized cross-correlation score to accept a match. |
| `11` | `baselineMm` | `120.0` | `> 0.0` | Physical baseline distance between left and right optical centers in mm. |
| `12` | `fx` | `1000.0` | `0.001 .. 100000` | Rectified horizontal focal length in pixels; workflow default is 3200. |
| `13` | `fy` | chosen `fx` | `0.001 .. 100000` | Rectified vertical focal length in pixels; workflow default is 3200. |
| `14` | `cx` | `-1.0` | `\ge -1.0` | Horizontal principal point in pixels (`-1.0` auto-centers to $(W-1)/2$). |
| `15` | `cy` | `-1.0` | `\ge -1.0` | Vertical principal point in pixels (`-1.0` auto-centers to $(H-1)/2$). |

---

## 5. Output Formats

### 1. Preview Image (`outPreview`)
Annotated RGB PNG based on `imageL`:
- **Green circle**: $(u_L, v_L)$ feature location.
- **Cyan horizontal vector**: Vector pointing leftward from $(u_L, v_L)$ to $(u_L - d, v_L)$, showing the disparity magnitude $d$.
- **Header overlay**: Displays `"Matches: M / N"`.

### 2. Matches Document (`outMatchesJson`)
Standardized JSON correspondence structure:
```json
{
  "schemaVersion": 1,
  "type": "stereo_matches",
  "method": "EPILINE_1D_CORRELATION",
  "coordinateUnits": "m",
  "parameters": {
    "maxDisparity": 64,
    "patchRadius": 4,
    "vTolerance": 1.0,
    "minCorrelation": 0.60,
    "baselineMm": 120.0,
    "fx": 3200.0,
    "fy": 3200.0,
    "cx": 835.5,
    "cy": 470.0
  },
  "images": {
    "left": "/abs/path/to/left.png",
    "right": "/abs/path/to/right.png",
    "width": 1672,
    "height": 941
  },
  "keypointsSource": "/abs/path/to/corners.keypoints.json",
  "count": 96,
  "matches": [
    {
      "leftId": 0,
      "left": { "u": 1082.0, "v": 354.0 },
      "right": { "u": 1077.0, "v": 354.0 },
      "disparity": 5.0,
      "score": 0.942,
      "point3d": { "x": 5.916, "y": -2.784, "z": 76.8 },
      "point3d_mm": { "x": 5916.0, "y": -2784.0, "z": 76800.0 }
    }
  ]
}
```

### 3. Point Cloud (`outPoints3d`)
Standard ASCII `.ply` file importable into MeshLab, CloudCompare, or 3D visualizers:
```text
ply
format ascii 1.0
comment coordinate_units meters
element vertex 88
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
5.916 -2.784 24.0 255 255 255
...
```
RGB colors are sampled directly from the corresponding pixel in the left image.

### 4. Position Estimate (`outPositionEstimateJson`)
The JSON contains the arithmetic mean of the valid reconstructed points and those points as `[x, y, z]` arrays. Coordinates are in meters; `average_point3d` is `null` when no valid 3D points were reconstructed.

```json
{
  "average_point3d": [5.916, -2.784, 76.8],
  "point_cloud": [[5.916, -2.784, 76.8]],
  "units": "m"
}
```

---

## 6. Build Instructions

Build using CMake and C++17:
```bash
cd cv-cli/cpp-simple-stereo
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```
Requirements:
- OpenCV 4.x (`core`, `imgproc`, `imgcodecs`, `calib3d`)
- `nlohmann/json` (installed via Homebrew or system package manager)
