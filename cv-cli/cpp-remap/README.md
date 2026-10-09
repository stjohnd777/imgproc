# Remap CLI

Resamples an image using output-to-input coordinate maps (`cv::remap`), for
rectification, distortion correction, or geometric transformations. Reads input
unchanged. Map output dimensions determine output-image dimensions.

```text
remap_cli input output [map_x] [map_y] [interpolation] [border_mode]
```

Defaults: map_x=identity, map_y="" (embedded), interpolation=linear,
border_mode=constant (zero fill). Presets: identity/flip_h/flip_v/flip_hv.
Interpolation: nearest/linear/cubic/lanczos4.
Border: constant/replicate/reflect/reflect101/wrap.
Files may be OpenCV FileStorage XML/YAML/JSON with `map_x`/`map_y` or image
maps such as EXR. Separate single-channel maps require both coordinates.
Stereo Rectification emits compatible float32 map pairs in one JSON file.

```sh
./cv-cli/cpp-remap/build/remap_cli img/one.png flipped.png flip_h "" linear constant
./cv-cli/cpp-remap/build/remap_cli left.png rectified.png leftMaps.json "" linear constant
```

Workflow: [Remap](../../elements/remap.json), image input/output, optional
`maps` text input overriding configured Map X.
Free-form toolbar: **REMAP**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
