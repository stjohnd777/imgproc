# Stereo Pose Estimator CLI (stub)

Scaffold for fixed-rig, known-target stereo pose inference using **ONNX Runtime**.
Python/PyTorch training and ONNX export will be separate jobs.
This project currently checks argument count and input-file readability, then
reports that inference is not implemented. It does not parse the model/metadata,
decode images, run a network, or create/overwrite the output file.
It must not be used to obtain navigation measurements yet.

## Build

Select this source directory in VS Code CMake Tools and build the default target.
Use `cv-cli/cpp-stereo-pose/build` as the build directory to match the workflow
executable path. The scaffold requires only CMake and a C++17 compiler; the
repository build helper automatically discovers this `cpp-*` project.

ONNX Runtime is the selected future inference backend, but is deliberately not
required or linked by this nonfunctional scaffold. Runtime dependency discovery,
tensor/preprocessing validation, inference, and export-parity tests must be added
when implementing inference. No OpenCV DNN fallback is planned.

## Interface and usage

```text
stereo_pose_cli left_image right_image model.onnx model_metadata.json pose.json
stereo_pose_cli --help
```

All five positional arguments are required, with no defaults.
The first two are the synchronized left/right image pair in that order.
The model and metadata are configured files, not workflow image inputs.
The final argument is the intended JSON output path.

Example from the repository root:

```sh
cv-cli/cpp-stereo-pose/build/stereo_pose_cli \
  left.png right.png models/stereo_pose.onnx models/model_metadata.json pose.json
```

Exit codes:
- `0`: help displayed (not an inference success).
- `2`: invalid arguments or missing/unreadable input file.
- `3`: inference not implemented; error printed to stderr, no pose written.

## Workflow and toolbar

Supports **Stereo Pose Estimator** (`stereo_pose_estimator`) in **AI/ML**:
- Required image inputs: `left`, `right`.
- Text/JSON output: `pose`.
- File parameters: `modelFile`, `metadataFile`, both defaulting to empty.
  Both must be selected from authorized folders before execution.

Convert/resize upstream if required by the eventual trained model. Both images
must use identical preprocessing, matching training. The existing workflow
runner surfaces the stub's nonzero exit as a failed step.
This CLI is **not** on the free-form image button bar.

## Intended inference contract (not implemented)

Model metadata will define fixed rig identity/calibration, supported target
models, target body frames/reference points, raw versus rectified inputs,
grayscale conversion, input size, resize policy, normalization, tensor
names/layout/types, and output decoding/scaling.
The exact metadata schema will be finalized with the trained model.

A planned model contract is a float32 stereo tensor `[batch, 2, height, width]`
(left then right), position `[batch, 3]`, and rotation `[batch, 6]`.
The rotation representation will be decoded to a valid DCM rather than exporting
nine unconstrained predictions.

The intended pose JSON contains `schemaVersion`, `referenceFrame`,
`targetReferencePoint`, `position_m`, `R_target_to_left_camera`, `range_m`,
`azimuth_deg`, and `elevation_deg`. Position refers to the configured target
reference point, not its visible-surface mean. Camera axes are X right, Y down,
Z forward; the transform is:

```text
point_left_camera = R_target_to_left_camera * point_target + position_m
range_m = sqrt(x*x + y*y + z*z)
azimuth = atan2(x, z)
elevation = atan2(-y, sqrt(x*x + z*z))
```

Angles are converted to degrees for JSON. Range/bearing are derived from
position, not independently predicted. No sample or placeholder pose is emitted
by the stub.
