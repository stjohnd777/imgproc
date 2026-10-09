# SURF CLI

Detects SURF keypoints on grayscale input, writing an annotated preview and
keypoint JSON. Descriptors are not exported. Input is loaded as 8-bit color.
Requires OpenCV contrib with nonfree support enabled. Unavailable SURF fails
explicitly; no alternative detector is substituted.

```text
surf_cli input output [keypoints_json] [hessianThreshold] [nOctaves] [nOctaveLayers]
```

Defaults: hessianThreshold=400 (1-50000), nOctaves=4 (1-8),
nOctaveLayers=3 (1-8). Omitted/empty JSON path writes a sibling
`output.keypoints.json`.

```sh
./cv-cli/cpp-surf/build/surf_cli img/one.png surf.png surf.json 400 4 3
```

Workflow: [SURF](../../elements/surf.json), preview/keypoints outputs.
Free-form toolbar: **URF** (current label), executable wired to SURF.
Build and positional conventions: [CLI reference](../README.md).
