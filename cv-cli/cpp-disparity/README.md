# Dense disparity CLI

The **Disparity** workflow element runs OpenCV StereoSGBM on an already-rectified
left/right pair. It is separate from the sparse Simple Stereo matcher.
Both images must have equal dimensions and use 8-bit grayscale, RGB, or RGBA.
Color is converted to grayscale; alpha is not used for matching.

Workflow: [Disparity](../../elements/disparity.json), under Stereo & 3D.
Free-form toolbar: **not wired to this CLI**. The visible DISPARITY button
opens an unfinished preparation dialog, not dense stereo execution.
Build and positional conventions: [CLI reference](../README.md).

Camera selection was removed from the placeholder element: camera specifications
alone do not rectify images. Undistort/remap the pair upstream when required.
Existing workflows retain their `left`, `right`, and `disparity` ports.

```
disparity_cli left.png right.png preview.png data.json \
  [numDisparities=64] [blockSize=9] [uniquenessRatio=10] \
  [speckleWindowSize=100] [speckleRange=2]
```

The range must be a multiple of 16 between 16 and 512. Block size must be odd,
between 3 and 21. The image must be wider than the range plus the block radius,
and at least as tall as the block. Reduce the range for small images.
P1/P2 are automatically set to 8/32 times the squared block size for grayscale.
Uniqueness ratio defaults to 10 (integer 0-100); speckle window defaults to
100 (integer 0-1000, 0 disables); speckle range defaults to 2 (integer 0-32).

Example with rectified images, from the repository root:

```sh
./cv-cli/cpp-disparity/build/disparity_cli \
  left_rectified.png right_rectified.png disparity.png disparity.json 64 9 10 100 2
```

Outputs:
- `disparity`: an 8-bit PNG visualization, scaled by `255 / numDisparities`.
  Invalid disparities and valid zero disparities both appear black.
- `data`: JSON with width, height, parameters, validCount, and a flat row-major
  `disparities` array. Values are disparities in pixels (`u_left - u_right`),
  decoded from OpenCV's 1/16-pixel fixed-point output; invalid values are null.
  Pixel `(x,y)` is at `y * width + x`. Use this output for measurements, not
  the visualization. JSON can be large for full-resolution images.

No metric depth or automatic rectification is performed. Subpixel output
resolution is not an accuracy guarantee. Textureless areas, occlusions, and
repetitive structures can still yield invalid or incorrect estimates.

Connect `data` and the matching Stereo Rectification `rectification` output
to [Dense Stereo](../cpp-dense-stereo/README.md) for a metric PLY cloud and
mean surface position/range/bearing. Do not connect the visualization instead.

Build this CMake project, then run the focused Node tests:
`node --test cv-cli/test/disparity.test.mjs`.
