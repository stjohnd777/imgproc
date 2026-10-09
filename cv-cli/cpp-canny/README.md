# Canny CLI

Converts an image to grayscale and runs Canny edge detection. Outputs an
8-bit edge image; input is loaded as 8-bit color.

```text
canny_cli input output [low] [high] [apertureSize] [l2gradient]
```

Defaults: low=80, high=180 (0-255), apertureSize=3 (odd 3-7),
l2gradient=0. Set l2gradient to 1 for Euclidean gradient magnitude.

```sh
./cv-cli/cpp-canny/build/canny_cli img/one.png edges.png 80 180 3 1
```

Workflow: [Canny](../../elements/canny.json), image input/output.
Free-form toolbar: **CANNY**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
