# BRISK CLI

Detects BRISK keypoints in a grayscale conversion of an 8-bit color-loaded
image. Produces an annotated preview and keypoint JSON; descriptors are not
exported.

```text
brisk_cli input output [keypoints_json] [thresh] [octaves] [patternScale]
```

Defaults: thresh=30 (0-255), octaves=3 (0-8), patternScale=1 (0.1-10).
Omitted/empty JSON path writes a sibling `output.keypoints.json`.

```sh
./cv-cli/cpp-brisk/build/brisk_cli img/one.png brisk.png brisk.json 30 3 1
```

Workflow: [BRISK](../../elements/brisk.json), preview and keypoints outputs.
Free-form toolbar: **BRISK**, executable wired. Boolean/optional conventions
and build instructions: [CLI reference](../README.md).
