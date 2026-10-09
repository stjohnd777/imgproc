# Threshold CLI

Selects an inclusive grayscale-intensity band, retaining original color inside
the band and setting pixels outside it to black. Optionally fills selected
pixels with a constant grayscale value. This is band selection, not just
OpenCV's single-cutoff threshold. Input is loaded as 8-bit color.

```text
threshold_cli input output low high [set_band_value] [value]
```

low/high are **required** CLI arguments in 0-255 with low <= high.
Defaults: set_band_value=0, value=255. Workflow/toolbar supply low=0,
high=255 by default. Set flag=1 and value=255 to create a white-on-black mask.

```sh
./cv-cli/cpp-threshold/build/threshold_cli img/one.png mask.png 100 255 1 255
```

Workflow: [Threshold](../../elements/threshold.json), image input/output.
Free-form toolbar: **THRESHOLD**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
