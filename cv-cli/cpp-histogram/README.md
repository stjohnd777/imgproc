# Histogram CLI

Plots a grayscale intensity histogram over 0-255, normalized to the largest
bin for display. Output is a 768x420 color plot, not raw histogram counts.
Input is loaded as 8-bit grayscale.

```text
histogram_cli input output [bins]
```

Default bins=256; allowed integer range 2-256.

```sh
./cv-cli/cpp-histogram/build/histogram_cli img/one.png histogram.png 64
```

Workflow: [Histogram](../../elements/histogram.json), image input and plot output.
Free-form toolbar: **HISTOGRAM**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
