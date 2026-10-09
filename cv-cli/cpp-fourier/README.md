# Fourier CLI

Produces an 8-bit, normalized log-magnitude Fourier spectrum visualization
from grayscale input, with low frequencies centered. Pads to an efficient DFT
size and trims odd dimensions for quadrant swapping. Output dimensions can
differ from input. This does not export complex coefficients or phase.

```text
fourier_cli input output
```

No optional arguments or parameter defaults.

```sh
./cv-cli/cpp-fourier/build/fourier_cli img/one.png spectrum.png
```

Workflow: [Fourier](../../elements/fourier.json), image -> spectrum image.
Free-form toolbar: **FOURIER**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
