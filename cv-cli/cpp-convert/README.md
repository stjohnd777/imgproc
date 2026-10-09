# Convert CLI

Resizes images, converts color channels, and converts bit depth. Reads unchanged
to preserve source depth/channel count until conversion is requested.

```text
convert_cli input output [width] [height] [preserveRatio] [colorMode] [depthMode] [interpolation]
```

Defaults: width=0, height=0 (keep each original dimension), preserveRatio=1,
colorMode=gray, depthMode=u8, interpolation=linear.
CLI also accepts -1 to retain a dimension. Positive dimensions are at most 32768.
preserveRatio=1 fits within the requested dimensions with black padding;
0 stretches. Color modes: gray/rgb/keep (rgb writes three color channels and
drops alpha). Depth: u8/u16/keep. Interpolation:
nearest/linear/cubic/area/lanczos4.
8-to-16 conversion multiplies by 257; 16-to-8 divides by 256.

```sh
./cv-cli/cpp-convert/build/convert_cli img/one.png converted.png 640 480 1 gray u8 area
```

Workflow: [Convert](../../elements/convert.json), image input/output.
Free-form toolbar: **CONVERT**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
