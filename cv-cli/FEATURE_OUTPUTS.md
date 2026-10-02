# Feature CLI outputs

SIFT, ORB, FAST, KAZE, BRISK, Corners (Shi–Tomasi), and SURF (the toolbar's existing `URF` label) write both a decorated image and keypoint JSON. Build each tool with CMake; these seven targets now require `nlohmann_json` in addition to OpenCV.

From the repository root, run `./build_cli.sh` to build all CLI tools, or
`./build_cli.sh sift orb corners` to build selected tools. Set
`CMAKE_BUILD_PARALLEL_LEVEL=4` to use four build jobs per tool. The script can
also be invoked by absolute path from another directory.

## CLI contract

```text
<detector>_cli <input_image> <preview_image> [keypoints_json] [detector parameters...]
```

If the JSON argument is omitted or is an empty string, replace the preview extension with `.keypoints.json`. To supply detector parameters while using the default sidecar, pass `""` as the JSON argument. Exit code 0 means both outputs were written; JSON write failures return 3. Stdout remains the preview path for compatibility.

This inserts a positional JSON argument before the parameters for six tools; SIFT already used that position. All repository toolbar calls and element definitions have been updated. External callers must insert the new argument too.

## Naming and discovery

Toolbar pairs share a UUID-based stem:

```text
ORB-<uuid>.png
ORB-<uuid>.keypoints.json
```

The IPC result includes `keypointsPath` alongside `path`, `image`, and `timingMs`, and the controller retains it in `tab.resultMeta`. These remain session scratch artifacts and are removed on normal app quit.

Workflow pairs use the existing producer/port naming convention:

```text
runs/<workflow>/<timestamp>-<run-uuid>/frames/0001/
  02_ORB__preview.png
  02_ORB__keypoints.json
```

Step order distinguishes duplicate node names; the run UUID prevents timestamp collisions. Graph edges pass explicit artifact paths, so downstream tools do not need filename searches. Workflow files persist. CLI-only callers own filename uniqueness; the CLI does not invent a UUID or change their chosen paths.

## JSON schema (version 1)

- `type`: `keypoints`.
- `detector`: SIFT, ORB, FAST, KAZE, BRISK, SHI_TOMASI, or SURF.
- `parameters`: the effective exposed detector parameter values.
- `image`: absolute source path, width, height, and coordinate convention.
- `preview.path`: absolute decorated-image path.
- `count` and `keypoints`: number of points and their records.
- `descriptors`: currently `null`; this change enumerates detections, not descriptors.

Each point matches the JavaScript `KeyPoint` constructor:

```json
{
  "id": 0,
  "u": 312.625,
  "v": 184.25,
  "sizePx": 7.8,
  "angleDeg": 123.4,
  "response": 0.031,
  "octave": 2,
  "descriptorRow": null
}
```

IDs are local to this file, not shared identities across cameras or frames. Coordinates retain floating-point precision and refer to the input image, with top-left origin, u right, v down, and integer pixel centers. The detector cannot infer whether its input is raw or rectified; calibration/rectification provenance must be carried by the pipeline.

Unknown metadata is null. Corners export coordinates with null scale, orientation, response and octave. FAST exports response but leaves scale/orientation/octave null. Other detectors export the metadata returned by OpenCV; octave remains detector-specific. Empty detections produce a valid document with an empty array.

This replaces SIFT's earlier unversioned x/y/size/angle export with u/v/sizePx/angleDeg; old saved JSON is not migrated. Every feature element now exposes a `keypoints` output in addition to `preview`. Recreate existing in-memory nodes to pick up added ports, since nodes copy port definitions at creation.

Descriptor computation and stereo matching are subsequent steps. Patch matching can use these coordinates plus the referenced original images; the decorated preview should not be used for matching.

## Verification

After building the seven tools:

```sh
node --test cv-cli/test/keypoints.test.mjs
```

Tests exercise the actual element argument templates, JSON-to-KeyPoint compatibility, blank images, explicit/default output paths, parameters, and write failures. SURF is explicitly skipped if the installed OpenCV lacks nonfree support.
