# Image simulation effects

The **Distort Image**, **Add Noise**, **Bilateral Filter**, **CLAHE**, and
**Morphology**, and **Image Diff** workflow elements use this project.
The simulation effects and filters accept one image; Image Diff accepts two.
All produce an image of the same dimensions and depth as their input.
Supported inputs: unsigned 8-bit/16-bit grayscale, RGB, and RGBA, except
CLAHE requires 8-bit for color. Use PNG
workflow outputs to avoid lossy compression and preserve depth.
Alpha is preserved by the filters and Add Noise; Image Diff emits opaque alpha.

Build this project with the existing build helper's `image-effects` selector.
It produces each element's `build/*_cli` executable in this directory;
the helper discovers the project when building all tools as well.

## Distort Image

```text
distort_cli input.png output.png fx fy cx cy k1 k2 p1 p2 [k3]
```

Uses the OpenCV five-coefficient radial/tangential model in that order.
K values are in pixels, and must correspond to the input resolution.
Choose a camera profile in the workflow dialog to fill the editable values;
profiles without distortion coefficients fill zeros. No automatic resolution
scaling occurs. The profile is a fill-in convenience, not a live reference.

The output is distorted: each output pixel is inverse-mapped to the ideal
input image, with bilinear interpolation and zero-filled (black/transparent)
borders. This is not undistortion with negated coefficients. Zero coefficients
preserve pixel values exactly. Nonfinite values and maps whose inversion
fails the 0.05-pixel forward-residual check are reported as errors. That check
does not guarantee a globally one-to-one mapping for arbitrary coefficients;
use physically plausible calibrated values. This is not a fisheye model.

## Add Noise

```text
add_noise_cli input.png output.png [sigma=5] [seed=0] [frame_index=0]
```

Adds independent, zero-mean Gaussian noise to each color channel. Alpha is
preserved. Computation uses floating point before rounding and clipping to
the image's valid range; clipping can bias the mean near black and white.
`sigma` is in 8-bit-equivalent intensity levels: 5 means five levels on a
0-255 scale, not 5 percent. For 16-bit images the sigma is multiplied by 257.
Sigma zero preserves all pixel values exactly.

Seed and frame index are nonnegative integers up to 2147483647. The workflow
automatically supplies its zero-based frame index, so a fixed seed produces
a repeatable sequence of different patterns, including when replaying the
same input image. Different stereo branches should use different seeds to
avoid correlated noise. Exact patterns are repeatable with the same build;
standard-library normal distributions may differ between platforms.

This is an image degradation model, not a calibrated photon/read-noise
simulation. It operates in stored intensity space (including gamma-encoded
PNG values); no linear-light conversion, shot noise, or exposure model is
applied.

## Bilateral Filter

```text
bilateral_cli input.png output.png [diameter=9] [sigma_color=25] [sigma_space=5]
```

Edge-preserving smoothing using `cv::bilateralFilter`. Neighborhood diameter
must be odd, 1-31 pixels; sigma values must be finite and positive. Color
sigma is in 8-bit-equivalent levels (scaled by 257 for 16-bit input), and
spatial sigma is in pixels. 16-bit data is filtered in floating point and
rounded back to its original depth. Borders reflect pixels without repeating
the edge pixel. Supports grayscale/RGB/RGBA; alpha is preserved.

## CLAHE

```text
clahe_cli input.png output.png [clip_limit=2] [tiles_x=8] [tiles_y=8]
```

Contrast-limited adaptive histogram equalization using `cv::createCLAHE`.
Clip limit must be finite and positive. Tile counts must be integers 1-64
and cannot exceed the input dimensions. Higher clip limits may amplify noise.
Supports 8/16-bit grayscale and 8-bit RGB/RGBA. Color processing equalizes
only the Lab L channel, then converts back to color; gamut clipping and
conversion rounding can still affect RGB values. Alpha is unchanged.
16-bit color is explicitly rejected rather than silently reduced to 8 bits.

## Morphology

```text
morphology_cli input.png output.png [operation=open] [shape=ellipse] [kernel_size=3] [iterations=1]
```

Operations: `erode`, `dilate`, `open`, `close`, `gradient`.
Shapes: `rectangle`, `ellipse`, `cross`.
Kernel size must be odd, 1-63; iterations must be an integer 1-20.
Uses a centered kernel and OpenCV's default neutral constant morphology
border values. Multiple iterations apply to each primitive erosion/dilation
within an opening/closing, not repeated complete opening/closing passes.
Supports 8/16-bit grayscale/RGB/RGBA; color channels are processed
independently, with alpha preserved. Binary masks after Threshold are the
typical input, but grayscale morphology is also supported.

Suggested pipelines:

```text
Synthetic Scene -> Add Noise -> Bilateral Filter -> UIView
Physical Camera -> CLAHE -> Corners -> UIView
Image -> Threshold -> Morphology (Open) -> Contours -> UIView
```

## Image Diff

```text
image_diff_cli img0.png img1.png output.png
```

The **Analysis** element has two inputs (`img0`, `img1`) and one image output
(`diff`). Uses `cv::absdiff` to compute `abs(img1 - img0)` per grayscale/color
channel, without unsigned wraparound or normalization. Identical images
produce black. Supports unsigned 8/16-bit grayscale, RGB, and RGBA. Both
inputs must match dimensions, depth, and channel count; no automatic
conversion, resizing, or alignment occurs.

RGBA compares the stored RGB channels, ignoring input alpha, and emits fully
opaque output alpha so the difference remains visible in UIView. Differences
in transparency alone are not detected.

This is a stateless operation: both inputs are taken from the current workflow
iteration. Branching one camera frame directly to both inputs produces black,
not motion detection. Supply separate t0/t1 images to compare time points;
automatic consecutive-frame comparison needs a separate frame-delay element
(not provided here). Camera motion, illumination changes, and noise can also
cause differences. A diff detects change, not object identity or trajectories.

```text
Image t0 -> img0 \
                  Image Diff -> Threshold -> Morphology -> UIView
Image t1 -> img1 /
```

## Example workflow and verification

```text
Synthetic Camera -> Distort Image -> Add Noise -> Undistort -> Processing
```

Distortion/undistortion round trips are approximate because resampling and
border loss are irreversible. Use the same K and coefficients at both nodes.

After building this project and the existing `undistort` project, run the
focused Node integration tests:

```sh
node --test cv-cli/test/image_effects.test.mjs
```

They check actual native outputs, distortion direction and round trips,
noise statistics, deterministic frame sequences, grayscale/color/alpha/depth
preservation, workflow argument expansion, and invalid-input errors.
Filter checks also verify edge-preserving noise reduction, local contrast
enhancement, morphology mask geometry, kernel choices, and iteration behavior.
Image Diff checks cover exact absolute differences, symmetry, identical images,
8/16-bit gray/color/RGBA, opaque alpha, workflow arguments, and mismatch errors.
