# Corners CLI

Detects Shi-Tomasi corners with `goodFeaturesToTrack` on grayscale input.
Outputs an annotated preview and numeric keypoint JSON, without descriptors.
Input is loaded as 8-bit color.

```text
corners_cli input output [keypoints_json] [maxCorners] [qualityLevel] [minDistance] [blockSize]
```

Defaults: maxCorners=500 (1-100000), qualityLevel=0.01 (>0, <=1),
minDistance=10 pixels (0-1000), blockSize=3 (1-31).
Omitted/empty JSON path writes a sibling `output.keypoints.json`.

```sh
./cv-cli/cpp-corners/build/corners_cli img/one.png corners.png corners.json 500 0.01 10 3
```

Workflow: [Corners](../../elements/corners.json), preview/keypoints outputs.
Free-form toolbar: **CORNERS**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
