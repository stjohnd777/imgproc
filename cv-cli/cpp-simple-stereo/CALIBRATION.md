# Stereo Camera Calibration & Rectification Guide

Step-by-step procedure for calibrating a binocular stereo rig using two **Blackfly BFLY-PGE-13S2M-CS** cameras (12 mm CS lenses, $1288 \times 964$ resolution), estimating lens distortion coefficients, and computing coordinate rectification maps (`map_x`, `map_y`) for `remap_cli` and `simple_stereo_cli`.

---

## 1. Physical Rig Setup & Target Preparation

### Camera Hardware & Optics
- **Sensors**: Sony ICX445 CCD ($1/3^{\prime\prime}$ optical format, $3.75\,\mu\text{m}$ square pixels).
- **Native Resolution**: $1288 \times 964$ (monochrome).
- **Lenses**: 12 mm CS-mount lenses with manual focus and aperture rings.
- **Lock Screws**: Focus both cameras sharply at your target operating distance (e.g. 1.0 m – 2.0 m). **Tighten the mechanical focus and aperture lock screws.** Do not adjust the focus rings after calibration, as changing focus alters the effective focal length and principal point.
- **Exposure Control**: Set fixed manual exposure and gain on both cameras so the white calibration squares measure $\approx 200\text{--}230$ intensity (not saturated at 255) and black squares have high contrast without blooming.
- **Rig Rigidity**: Ensure both cameras are bolted rigidly to an extrusion or plate. Any relative flex or twist between cameras will invalidate the epipolar alignment.

### Target Preparation
- **Checkerboard or ChArUco Pattern**: A grid of $9 \times 6$ or $10 \times 7$ internal corners.
- **Flat Backing**: Mount the printed pattern onto a completely rigid, optically flat substrate (float glass, precision aluminum plate, or thick foam board). If the board is bowed or warped, the estimated lens distortion and stereo extrinsics will be corrupted.
- **Measure Square Size**: Use digital calipers to measure the exact square dimension in millimeters (e.g., $30.00\,\text{mm}$).

---

## 2. Image Capture Protocol

Collect **20 to 30 synchronous image pairs** (`left_01.png`, `right_01.png`, etc.) where both cameras see the entire checkerboard:

```
calib/
  ├── left_01.png,  right_01.png
  ├── left_02.png,  right_02.png
  ...
  └── left_25.png,  right_25.png
```

### Best Practices for Capture:
1. **Field of View Coverage**:
   - Capture images with the board filling $40\%\text{--}70\%$ of the image frame.
   - Capture board positions near the corners and outer perimeters of the sensor FOV. Lens distortion ($k_1, k_2$) is strongest at the edges; if all captures are in the center, edge distortion cannot be modeled accurately.
2. **Orientations & Tilts**:
   - Tilt the board forward and backward ($\approx 15^\circ\text{--}30^\circ$).
   - Tilt the board left and right ($\approx 15^\circ\text{--}30^\circ$).
   - Rotate the board clockwise and counter-clockwise in the plane.
   - *Do not* capture only flat, perpendicular shots; depth $Z$ and focal length $f$ cannot be decoupled without perspective foreshortening.
3. **Synchronous Triggering**:
   - Both cameras must capture the target at the exact same instant (or while the target is held completely stationary on a tripod/stand).

---

## 3. Calibration Pipeline (OpenCV Workflow)

```
[20-30 Synchronized Image Pairs]
               │
               ▼
 1. cv::findChessboardCorners & cv::cornerSubPix
       │  (Extract sub-pixel corner coordinates (u, v))
       ▼
 2. cv::calibrateCamera (Individual Camera Intrinsics)
       ├── Left:  K1 (3x3), D1 (k1, k2, p1, p2, k3)
       └── Right: K2 (3x3), D2 (k1, k2, p1, p2, k3)
       │
       ▼
 3. cv::stereoCalibrate (Relative Pose Extrinsics)
       ├── Rotation matrix R (3x3)
       └── Translation vector T (3x1)  => Baseline B = |T|
       │
       ▼
 4. cv::stereoRectify & cv::initUndistortRectifyMap
       ├── R1, R2 (3x3 rectification rotations)
       ├── P1, P2 (3x4 projection matrices with identical row alignment)
       ├── Q (4x4 disparity-to-depth reprojection matrix)
       └── Coordinate Lookup Rectification Maps:
             ├── maps/rectify_left.yml  (map_x, map_y)
             └── maps/rectify_right.yml (map_x, map_y)
```

---

## 4. OpenCV Implementation Recipe

### Step 1: Detect Corners Sub-pixel
```cpp
std::vector<cv::Point3f> objectPointsGrid; // 3D coordinates (X, Y, 0) in mm
// Populate objectPointsGrid based on square size (e.g. 30.0 mm)

std::vector<cv::Point2f> cornersL, cornersR;
bool foundL = cv::findChessboardCorners(imgL, boardSize, cornersL);
bool foundR = cv::findChessboardCorners(imgR, boardSize, cornersR);

if (foundL && foundR) {
    cv::cornerSubPix(grayL, cornersL, cv::Size(11, 11), cv::Size(-1, -1),
                     cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::COUNT, 30, 0.01));
    cv::cornerSubPix(grayR, cornersR, cv::Size(11, 11), cv::Size(-1, -1),
                     cv::TermCriteria(cv::TermCriteria::EPS + cv::TermCriteria::COUNT, 30, 0.01));
}
```

### Step 2: Calibrate Left & Right Intrinsics
```cpp
cv::Mat K1, D1, K2, D2;
std::vector<cv::Mat> rvecsL, tvecsL, rvecsR, tvecsR;

double rmsL = cv::calibrateCamera(objectPointsList, imagePointsL, imageSize, K1, D1, rvecsL, tvecsL);
double rmsR = cv::calibrateCamera(objectPointsList, imagePointsR, imageSize, K2, D2, rvecsR, tvecsR);
```

### Step 3: Compute Stereo Extrinsics
```cpp
cv::Mat R, T, E, F;
int flags = cv::CALIB_FIX_INTRINSIC; // Use refined single-camera intrinsics
double rmsStereo = cv::stereoCalibrate(
    objectPointsList, imagePointsL, imagePointsR,
    K1, D1, K2, D2, imageSize,
    R, T, E, F, flags,
    cv::TermCriteria(cv::TermCriteria::COUNT + cv::TermCriteria::EPS, 100, 1e-6)
);

double baselineMm = cv::norm(T); // Euclidean distance between camera centers
```

### Step 4: Rectify and Generate `remap` Coordinate Grids
```cpp
cv::Mat R1, R2, P1, P2, Q;
cv::Rect validRoiL, validRoiR;

cv::stereoRectify(
    K1, D1, K2, D2, imageSize,
    R, T, R1, R2, P1, P2, Q,
    cv::CALIB_ZERO_DISPARITY, 0, imageSize, &validRoiL, &validRoiR
);

cv::Mat mapL_x, mapL_y, mapR_x, mapR_y;
cv::initUndistortRectifyMap(K1, D1, R1, P1, imageSize, CV_32FC1, mapL_x, mapL_y);
cv::initUndistortRectifyMap(K2, D2, R2, P2, imageSize, CV_32FC1, mapR_x, mapR_y);

// Save maps to YAML for remap_cli and the workflow engine
{
    cv::FileStorage fsL("maps/rectify_left.yml", cv::FileStorage::WRITE);
    fsL << "map_x" << mapL_x;
    fsL << "map_y" << mapL_y;
    fsL << "P" << P1;
    fsL << "Q" << Q;
}
{
    cv::FileStorage fsR("maps/rectify_right.yml", cv::FileStorage::WRITE);
    fsR << "map_x" << mapR_x;
    fsR << "map_y" << mapR_y;
    fsR << "P" << P2;
    fsR << "Q" << Q;
}
```

---

## 5. Integrating Results into the Project

### 1. Update Camera Specs
Update `camera_spec/bfly_pge_13s2m_cs.json` with the calibrated parameters:
```json
"intrinsics": {
  "calibrated": true,
  "resolution": { "width": 1288, "height": 964 },
  "fx": 3215.4,
  "fy": 3213.8,
  "cx": 641.2,
  "cy": 482.6,
  "K": [
    [3215.4, 0.0, 641.2],
    [0.0, 3213.8, 482.6],
    [0.0, 0.0, 1.0]
  ],
  "distortion": [-0.1415, 0.1172, 0.0008, -0.0004, 0.0]
}
```

### 2. Configure `Remap` in the Workflow
Place `maps/rectify_left.yml` and `maps/rectify_right.yml` in `maps/` or `img/`:
- **Left Stream Remap Node**:
  - `map_x`: `maps/rectify_left.yml` (contains both `map_x` and `map_y`)
  - `interpolation`: `linear`
  - `borderMode`: `constant`
- **Right Stream Remap Node**:
  - `map_x`: `maps/rectify_right.yml`
  - `interpolation`: `linear`
  - `borderMode`: `constant`

### 3. Configure `Simple Stereo` Node
- `baselineMm`: Value of $\|T\|$ (e.g. $120.0\,\text{mm}$).
- `fx`, `fy`: Common focal length from rectified projection matrix $P_1[0,0]$ (e.g. $\sim 3200\,\text{px}$).
- `cx`, `cy`: Principal point from rectified projection matrix $P_1[0,2]$ and $P_1[1,2]$.
- `maxDisparity`: Typically $64\text{--}128\,\text{px}$.

---

## 6. Verification & Epipolar Quality Inspection

1. **CLI Rectification Test**:
   ```bash
   ./cv-cli/cpp-remap/build/remap_cli test_left.png  /tmp/rect_left.png  maps/rectify_left.yml
   ./cv-cli/cpp-remap/build/remap_cli test_right.png /tmp/rect_right.png maps/rectify_right.yml
   ```
2. **Visual Collinearity Check**:
   - Inspect `/tmp/rect_left.png` and `/tmp/rect_right.png` in the app by splitting editor groups side by side.
   - Pick several recognizable high-contrast points across the image (e.g. screws, corners of a box).
   - Check the $v$ pixel readout in the status bar:
     $$\Delta v = |v_{\text{left}} - v_{\text{right}}| \le 1.0\,\text{px}$$
   - When $\Delta v \le 1.0\,\text{px}$ across the entire frame, horizontal epipolar rectification is successful and `Simple Stereo` will achieve high-confidence matching with minimum vertical tolerance.
