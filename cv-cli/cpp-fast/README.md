# FAST CLI

Detects FAST corners on grayscale input, producing an annotated preview and
keypoint JSON without descriptors. Input is loaded as 8-bit color.

```text
fast_cli input output [keypoints_json] [threshold] [nonmaxSuppression]
```

Defaults: threshold=20 (0-255), nonmaxSuppression=1.
Set nonmaxSuppression=0 to disable suppression of neighboring responses.
Omitted/empty JSON path writes a sibling `output.keypoints.json`.

```sh
./cv-cli/cpp-fast/build/fast_cli img/one.png fast.png fast.json 20 1
```

Workflow: [FAST](../../elements/fast.json), preview/keypoints outputs.
Free-form toolbar: **FAST**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
