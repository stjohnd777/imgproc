# Sobel CLI

Computes horizontal/vertical grayscale derivatives, converts their absolute
values to 8-bit, and displays x, y, or their equally weighted combination.
The result is a visualization, not signed numerical derivatives.
Input is loaded as 8-bit color.

```text
sobel_cli input output [x|y|xy] [ksize]
```

Defaults: mode=xy, ksize=3 (odd 1-7).

```sh
./cv-cli/cpp-sobel/build/sobel_cli img/one.png sobel.png xy 3
```

Workflow: [Sobel](../../elements/sobel.json), image input/output.
Free-form toolbar: **SOBEL X**, **SOBEL Y**, **SOBEL XY**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
