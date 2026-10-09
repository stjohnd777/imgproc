# Stereo calibration and rectification

Two workflow elements under **Geometry & Calibration**:

Workflow declarations: [Stereo Calibrate](../../elements/stereo_calibrate.json)
and [Stereo Rectification](../../elements/stereo_rectify.json).
Free-form toolbar: **neither CLI is available**; use workflow elements or
invoke the executables directly. Build/positional conventions:
[CLI reference](../README.md).

- **Stereo Calibrate** reads two checkerboard image folders in one batch and
  estimates each camera's intrinsics/distortion, then the left-to-right R/T
  with the intrinsics fixed. Its implementation follows the same OpenCV
  calibration sequence as the shared native calibration library, without
  requiring that library's Eigen/server dependencies.
- **Stereo Rectification** reads that calibration (connected text port or
  saved JSON file), and generates Q, R1/R2, P1/P2, valid ROIs, and two map files.
  It does not rectify image pixels itself.

## Capture and calibration

Use simultaneous left/right images of a stationary checkerboard with known
square size. Pair by **identical filename** in separate folders; all supported
image filenames must have counterparts. Inputs are 8-bit PNG/JPEG/BMP/PGM/PPM/TIFF,
with equal resolution. Board columns/rows are **inner corner counts**.
Square size is in meters. Default minimum is eight accepted pairs.
Use varied tilts, distances, and positions across the field of view, with the
entire board visible in both cameras. Do not use repeated identical views.
Avoid symmetric board orientations that make corner ordering ambiguous.

Undetected boards are explicitly reported and listed in `rejectedPairs`.
Unreadable images, mismatched pairs/sizes, insufficient detections, and write
failures fail the run. Calibration reports left/right/stereo RMS in pixels,
accepted/rejected filenames, and the estimated baseline. Low RMS alone does not
prove calibration accuracy; validate on independent pairs and known distances.
The current version estimates both cameras rather than accepting fixed existing
intrinsics, and supports the standard five-coefficient pinhole model, not fisheye.

```
stereo_calibrate_cli leftDir rightDir calibration.json \
  [columns=9] [rows=6] [squareSizeM=0.025] [minPairs=8]

stereo_rectify_cli calibration.json rectification.json \
  leftMaps.json rightMaps.json [alpha=0]
```

Defaults: inner corner columns=9 (3-30), rows=6 (3-30),
squareSizeM=0.025 (0.000001-10), minPairs=8 (3-1000), alpha=0 (-1 to 1).
Calibration needs two folders and an output path; rectification needs one
calibration input and three output paths. No implicit camera profile is used.

Example from the repository root (prepare an `out` directory first):

```sh
./cv-cli/cpp-stereo-calibration/build/stereo_calibrate_cli \
  checkerboards/left checkerboards/right out/calibration.json 9 6 0.025 8
./cv-cli/cpp-stereo-calibration/build/stereo_rectify_cli \
  out/calibration.json out/rectification.json out/leftMaps.json out/rightMaps.json 0
```

## Known synthetic calibration

You can skip board calibration and supply this schema to Stereo Rectification.
This example uses integer pixel-center coordinates, a 640x480 image, and a
120 mm horizontal baseline. Use intrinsics that match your actual rendered
images, including their pixel-center convention, cropping, and resolution.
Matrices are nested row-major arrays; **T is a 3x1 column**, not a camera pose:

```json
{
  "schemaVersion": 1,
  "type": "stereo_calibration",
  "imageWidth": 640,
  "imageHeight": 480,
  "lengthUnits": "m",
  "cameraAxes": "x_right_y_down_z_forward",
  "transformConvention": "point_C2 = R * point_C1 + T",
  "K1": [[700,0,319.5],[0,700,239.5],[0,0,1]],
  "K2": [[700,0,319.5],[0,700,239.5],[0,0,1]],
  "D1": [0,0,0,0,0],
  "D2": [0,0,0,0,0],
  "R": [[1,0,0],[0,1,0],[0,0,1]],
  "T": [[-0.12],[0],[0]]
}
```

T is negative X because it converts left-camera point coordinates into the
right-camera frame when the right camera center is physically to the right.
Do not pass Blender world poses directly: convert camera axes and calculate
the relative transform first.

## Workflow connections

```
Stereo Calibrate.calibration -> Stereo Rectification.calibration
Stereo Rectification.leftMaps  -> Left Remap.maps
Stereo Rectification.rightMaps -> Right Remap.maps
Left image  -> Left Remap.image  -> Disparity.left
Right image -> Right Remap.image -> Disparity.right
```

Remap's optional `maps` input takes precedence over its Map X setting; the
generated OpenCV FileStorage JSON contains both `map_x` and `map_y` as float32
matrices. No manual format conversion is required. Existing Remap workflows
without that input keep their file/preset settings.

The `rectification` output is ordinary JSON containing **Q** and its metadata.
Save it with the matching maps using text sinks. Q expects numeric pixel
disparity, not a preview image or undecoded fixed-point values. Results are in
meters in the **rectified left camera frame**. R1 transforms original left-camera
coordinates to that rectified frame. Current Disparity requires horizontal stereo
and nonnegative left-minus-right disparity, so vertical/reversed rigs are rejected.
Alpha is -1 for OpenCV default, 0 to crop invalid borders, or 1 to retain all
source pixels; resolution is unchanged. Maps and Q must be regenerated together
if calibration or rectification settings change.

Run calibration as a separate setup workflow so it is not repeated for each
mission image. A no-input calibration node in a multi-frame graph currently runs
once per frame; save its outputs and reuse them instead.
[Dense Stereo](../cpp-dense-stereo/README.md) accepts
`rectification` and numeric Disparity `data`, producing a metric point cloud
and mean visible-surface position/range/bearing. A dedicated robust target-center
Range & Bearing estimator remains future work.

Generated maps combine undistortion and rectification. Apply them directly to
raw camera images; a separate Undistort step before these maps would correct
distortion twice. Sparse stereo must detect keypoints on the rectified left
image and use rectified P1 intrinsics, not original K.

## Validation

Build this CMake project (including the test fixture generator), then run:
`node --test cv-cli/test/stereo_calibration.test.mjs`.
Tests generate perspective checkerboard pairs with known geometry, exercise both
CLIs, validate Q numerically, and pass generated maps through the existing Remap.

### Test fixture generator

`stereo_calibration_fixture outputDirectory` creates twelve synthetic 640x480
checkerboard pairs in `left` and `right` subdirectories. No optional parameters.
Known geometry: 9x6 inner corners, 0.035 m squares, 700 px focal length,
0.12 m baseline. This is a test utility, not a workflow element or toolbar
action; generated files may overwrite matching filenames in the chosen folder.

```sh
./cv-cli/cpp-stereo-calibration/build/stereo_calibration_fixture /tmp/stereo-fixture
./cv-cli/cpp-stereo-calibration/build/stereo_calibrate_cli \
  /tmp/stereo-fixture/left /tmp/stereo-fixture/right /tmp/stereo-fixture/calibration.json 9 6 0.035 8
```
