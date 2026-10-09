# Stretch CLI

Maps a chosen intensity interval to 0-255 for display. Supports unsigned
8/16-bit input, outputs 8-bit with the same channel count. One common scale
is derived from all channel samples, including alpha when present.

```text
stretch_cli input output [mode] [low] [high]
```

Default mode=percentile, low=0.5%, high=99.5%; require
0 <= low < high <= 100. `minmax` uses observed extrema and ignores low/high.
`bits` interprets low as sensor bit depth (rounded to an integer 1-16),
mapping 0 through 2^bits-1 to 0-255; explicitly supply it (the native
low default 0.5 is not a useful bit depth). Empty intensity ranges fail.
Values outside the selected range are clipped.

```sh
./cv-cli/cpp-stretch/build/stretch_cli input16.png stretched.png percentile 0.5 99.5
./cv-cli/cpp-stretch/build/stretch_cli input16.png sensor12.png bits 12
```

Workflow: [Stretch](../../elements/stretch.json), image input/output.
Free-form toolbar: **STRETCH**, executable wired; dialog's bits default is 12.
Build and positional conventions: [CLI reference](../README.md).
