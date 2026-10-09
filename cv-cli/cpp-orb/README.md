# ORB CLI

Detects ORB keypoints in a grayscale image pyramid. Outputs annotated preview
and keypoint JSON. Binary descriptors are not exported by this CLI.
Input is loaded as 8-bit color.

```text
orb_cli input output [keypoints_json] [nfeatures] [scaleFactor] [nlevels] [fastThreshold]
```

Defaults: nfeatures=1000 (1-100000), scaleFactor=1.2 (1.01-4),
nlevels=8 (1-16), fastThreshold=20 (0-255).
Omitted/empty JSON path writes a sibling `output.keypoints.json`.

```sh
./cv-cli/cpp-orb/build/orb_cli img/one.png orb.png orb.json 1000 1.2 8 20
```

Workflow: [ORB](../../elements/orb.json), preview/keypoints outputs.
Free-form toolbar: **ORB**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
