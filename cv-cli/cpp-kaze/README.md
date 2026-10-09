# KAZE CLI

Detects KAZE features on grayscale input using a nonlinear scale space.
Outputs annotated preview and keypoint JSON, not descriptors.
Input is loaded as 8-bit color.

```text
kaze_cli input output [keypoints_json] [threshold] [nOctaves] [nOctaveLayers]
```

Defaults: threshold=0.001 (0-1), nOctaves=4 (1-8),
nOctaveLayers=4 (1-8). Omitted/empty JSON path writes a sibling
`output.keypoints.json`.

```sh
./cv-cli/cpp-kaze/build/kaze_cli img/one.png kaze.png kaze.json 0.001 4 4
```

Workflow: [KAZE](../../elements/kaze.json), preview/keypoints outputs.
Free-form toolbar: **KAZE**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
