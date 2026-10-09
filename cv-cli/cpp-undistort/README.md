# Undistort CLI

Corrects pinhole radial/tangential lens distortion with `cv::undistort`.
Uses the supplied K as both input and output intrinsics, preserving image
dimensions; invalid border areas can be black. Not stereo rectification and
not a fisheye model. Input is loaded as 8-bit color.

```text
undistort_cli input output fx fy cx cy k1 k2 p1 p2 [k3]
```

All calibration values except k3 are required; k3 defaults to 0.
Focal lengths must be positive; all values finite. K is in pixels at the
input resolution. D order: k1,k2,p1,p2,k3. Do not negate coefficients.

```sh
./cv-cli/cpp-undistort/build/undistort_cli input.png corrected.png 3200 3200 643.5 481.5 -0.1 0.01 0 0 0
```

The coefficients above are illustrative, not measured Blackfly calibration.
Workflow: [Undistort](../../elements/undistort.json), image input/output,
editable intrinsics/distortion and camera-profile fill-in.
Free-form toolbar: **UNDISTORT**, executable wired; dialog can fill values
from camera profiles. Native required values have no automatic camera defaults.
Build and positional conventions: [CLI reference](../README.md).
