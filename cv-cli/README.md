# Native CLI reference

Each project README describes purpose, positional arguments/defaults, examples,
workflow integration, and free-form image toolbar availability. Examples run
from the repository root after building the relevant project with VS Code
CMake Tools. Input names are illustrative; supply your own files. Create output
parent directories beforehand unless a tool explicitly creates them.

`<argument>` is required; `[argument]` is optional. Defaults below are native
CLI defaults, which can differ from workflow/dialog defaults. Arguments are
positional: do not omit an earlier slot when supplying later parameters.
Most tools print usage when invoked without required arguments; `--help` is
not universally supported. Zero exit status means success; nonzero means failure.
See individual sources for exact exit codes.

## Tools

| CLI | Reference | Workflow | Free-form toolbar |
|---|---|---|---|
| add_noise_cli | [Image effects](cpp-image-effects/README.md#add-noise) | Add Noise | No |
| bilateral_cli | [Image effects](cpp-image-effects/README.md#bilateral-filter) | Bilateral Filter | No |
| brisk_cli | [BRISK](cpp-brisk/README.md) | BRISK | BRISK |
| canny_cli | [Canny](cpp-canny/README.md) | Canny | CANNY |
| clahe_cli | [Image effects](cpp-image-effects/README.md#clahe) | CLAHE | No |
| concat: hconcat_cli / vconcat_cli | [Image effects](cpp-image-effects/README.md#image-concatenation) | Horizontal / Vertical Concat | No |
| contours_cli | [Contours](cpp-contours/README.md) | Contours | CONTOURS |
| convert_cli | [Convert](cpp-convert/README.md) | Convert | CONVERT |
| corners_cli | [Corners](cpp-corners/README.md) | Corners | CORNERS |
| disparity_cli | [Disparity](cpp-disparity/README.md) | Disparity | No execution; DISPARITY dialog is a placeholder |
| dense_stereo_cli | [Dense Stereo](cpp-dense-stereo/README.md) | Dense Stereo | No |
| distort_cli | [Image effects](cpp-image-effects/README.md#distort-image) | Distort Image | No |
| fast_cli | [FAST](cpp-fast/README.md) | FAST | FAST |
| fourier_cli | [Fourier](cpp-fourier/README.md) | Fourier | FOURIER |
| gaussian_cli | [Gaussian](cpp-gaussian/README.md) | Gaussian | GAUSSIAN |
| histogram_cli | [Histogram](cpp-histogram/README.md) | Histogram | HISTOGRAM |
| image_diff_cli | [Image effects](cpp-image-effects/README.md#image-diff) | Image Diff | No |
| kaze_cli | [KAZE](cpp-kaze/README.md) | KAZE | KAZE |
| median_cli | [Median](cpp-median/README.md) | Median | MEDIAN |
| morphology_cli | [Image effects](cpp-image-effects/README.md#morphology) | Morphology | No |
| orb_cli | [ORB](cpp-orb/README.md) | ORB | ORB |
| remap_cli | [Remap](cpp-remap/README.md) | Remap | REMAP |
| sift_cli | [SIFT](cpp-sift/README.md) | SIFT | SIFT |
| simple_stereo_cli | [Simple Stereo](cpp-simple-stereo/README.md) | Simple Stereo | No |
| sobel_cli | [Sobel](cpp-sobel/README.md) | Sobel | SOBEL X / Y / XY |
| stereo_calibrate_cli / stereo_rectify_cli | [Stereo calibration](cpp-stereo-calibration/README.md) | Stereo Calibrate / Stereo Rectification | No |
| stereo_pose_cli | [Stereo Pose Estimator (stub)](cpp-stereo-pose/README.md) | Stereo Pose Estimator (AI/ML; inference not implemented) | No |
| stretch_cli | [Stretch](cpp-stretch/README.md) | Stretch | STRETCH |
| surf_cli | [SURF](cpp-surf/README.md) | SURF | URF (current toolbar label) |
| threshold_cli | [Threshold](cpp-threshold/README.md) | Threshold | THRESHOLD |
| undistort_cli | [Undistort](cpp-undistort/README.md) | Undistort | UNDISTORT |
| usb_camera_cli | [USB camera](cpp-usb-camera/README.md) | Physical Camera | No |

The free-form toolbar operates on image tabs. Its labels and executable
allow-list are defined in [main.js](../main.js); visible buttons alone do not
guarantee execution (notably DISPARITY and SURFACE).
Workflow declarations live in [elements/](../elements/).

The calibration project also builds `stereo_calibration_fixture`, a test-only
checkerboard generator, documented in its project README. USB capture tests
build `capture_frames_test`; it is a CTest test binary, not a user CLI.

Feature detector tools output annotated previews and keypoint JSON. They
currently **do not export descriptor matrices** even when the algorithm supports
descriptors. See each detector README before using the results for matching.
