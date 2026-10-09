# Dense Stereo CLI

Reconstructs a metric point cloud and arithmetic-mean surface position from
numeric disparity and matching rectification Q. It does not perform matching:
the Disparity element already runs dense StereoSGBM. This CLI is the next stage.

Workflow: [Dense Stereo](../../elements/dense_stereo.json), under **Stereo & 3D**.
Free-form toolbar: **not available**. Build this project using VS Code CMake
Tools. General conventions: [CLI reference](../README.md).

## Usage and defaults

```text
dense_stereo_cli disparity.json rectification.json position.json points.ply \
  [minDisparity=0.01] [maxRangeM=10000] [minPoints=10] [mask]
```

Example from the repository root, with a binary target mask:

```sh
./cv-cli/cpp-dense-stereo/build/dense_stereo_cli \
  disparity.json rectification.json position.json points.ply 0.01 10000 10 target_mask.png
```

Omit the mask to summarize all accepted pixels. Parameters:

| Parameter | Default | Meaning |
|---|---|---|
| minDisparity | 0.01 | Exclusive minimum pixel disparity, 0-512; removes zero/near-zero values |
| maxRangeM | 10000 | Maximum camera range in meters, positive, up to 1e9 |
| minPoints | 10 | Minimum accepted count for a valid aggregate estimate, 1-100000000 |
| mask | none | Same-sized unsigned 8-bit single-channel image; nonzero selects pixels |

Supply distinct input/output paths and create parent output directories first.
Malformed inputs, incompatible dimensions/conventions, invalid settings,
unreadable masks, and write errors fail explicitly with nonzero exit status.

## Inputs and outputs

- `disparity`: connect **Disparity.data**, not its grayscale preview.
  The JSON contains row-major floating-point pixel disparities already decoded
  from OpenCV fixed-point units. Null means invalid.
- `calibration`: connect **Stereo Rectification.rectification**. Q and metadata
  must match the actual remapped image pair and dimensions. A bare matrix,
  original camera calibration, or Blender world pose is not sufficient input.
- `mask`: optional target selection in the rectified **left** image coordinates.

Reprojection computes `Q * [u,v,d,1]`, then divides XYZ by the homogeneous
fourth component. It is equivalent to Q reprojection without treating invalid
pixels as finite points. This implementation uses double precision.
Null/low disparities, invalid geometry, behind-camera points, invalid image
regions, and points beyond the range limit are excluded with categorized counts.
Both valid ROIs from rectification are used (right coordinate is u-d).
When manual rectification metadata omits ROIs, full image bounds are used.
No automatic statistical outlier rejection or matcher-confidence weighting is
performed; masks and limits do not guarantee accurate correspondence.

Outputs:

- `points3d`: ASCII PLY, XYZ doubles in meters, no colors. One vertex per
  accepted pixel; even a dense cloud can contain holes due to invalid matches.
- `positionEstimate`: JSON with `average_point3d`, `range_m`,
  `bearing_unit_vector`, `azimuth_deg`, `elevation_deg`, status/reason,
  point count, selection, rejection counts, parameters and range statistics.
  Point arrays are not duplicated into JSON; use PLY for the full cloud.

Coordinates are **rectified left camera**, X right/Y down/Z forward.
Range is the norm of the mean position, not mean point range. The latter is
separately reported in `rangeStatistics.meanM`; median/min/max/population
standard deviation describe accepted surface-point ranges, not estimator
uncertainty. Azimuth is `atan2(X,Z)`; elevation is
`atan2(-Y,sqrt(X*X+Z*Z))`, in degrees, positive up.

The average weights every accepted pixel equally. This estimates a **visible
surface centroid**, not the model origin, center of mass, or attitude.
Without a mask, background and unrelated objects can contaminate the estimate.

If there are fewer than minPoints, the CLI still writes the accepted cloud and
statistics, but reports `status: "unavailable"` and null aggregate position,
range, and bearing. It logs this explicitly. A valid processing result is not
a valid navigation observation automatically.

## Correct physical-camera chain

```text
Paired checkerboard folders -> Stereo Calibrate -> Stereo Rectification

Raw left  + leftMaps  -> Remap -> Disparity.left
Raw right + rightMaps -> Remap -> Disparity.right
Disparity.data + Stereo Rectification.rectification -> Dense Stereo
Dense Stereo.positionEstimate -> UIViewText
Dense Stereo.points3d -> Save Point Cloud
```

Stereo Calibrate produces K1/K2, D1/D2, R/T and error statistics.
Stereo Rectification uses **both distortion coefficients and relative geometry**
to generate maps and Q. Those maps already combine undistortion/rectification:
**do not Undistort first and then use these maps**. Q does not correct lens
distortion; it reconstructs from the resulting rectified coordinates.

Retain the original K/D/R/T to regenerate maps/Q. Keep maps/Q together and
do not crop/resize images afterward without adjusting the calibration.
Two independent Physical Camera capture nodes are not a synchronized acquisition
system; moving-scene stereo needs coordinated exposures and paired timestamps.

For Simple Stereo, detect Corners on the **rectified left** image and connect
`Corners.keypoints` to `Simple Stereo.leftKeypoints`. Use fx/fy/cx/cy from
rectification P1 and baseline in millimeters. Dense Stereo instead consumes Q
directly and does not need Corners.

Ideal parallel, distortion-free synthetic pairs may skip remapping, but still
require matching Q and pixel conventions. If Distort Image deliberately adds
distortion, matching correction maps are required before stereo.

## Validation

After building Dense Stereo, Disparity, and Stereo Calibration:

```sh
node --test cv-cli/test/dense_stereo.test.mjs
```

Tests cover a known 100 m Q reconstruction, fractional disparities, mask/ROI
selection, range/angle conventions, unavailable results, bad inputs, workflow
execution, and an actual StereoSGBM-to-Q reconstruction of a 15 m plane.
