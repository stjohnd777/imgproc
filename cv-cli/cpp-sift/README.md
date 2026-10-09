# SIFT CLI

Detects scale-space SIFT keypoints on grayscale input. Outputs an annotated
preview and keypoint JSON; SIFT descriptors are not exported.
Input is loaded as 8-bit color.

```text
sift_cli input output [keypoints_json] [nfeatures] [nOctaveLayers] [contrastThreshold] [edgeThreshold] [sigma]
```

Defaults: nfeatures=0 (all; 0-100000), nOctaveLayers=3 (1-8),
contrastThreshold=0.04 (0-1), edgeThreshold=10 (0-100),
sigma=1.6 (0.1-10). Omitted/empty JSON path writes a sibling
`output.keypoints.json`.

```sh
./cv-cli/cpp-sift/build/sift_cli img/one.png sift.png sift.json 500 3 0.04 10 1.6
```

Workflow: [SIFT](../../elements/sift.json), preview/keypoints outputs.
Free-form toolbar: **SIFT**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
