# Gaussian CLI

Applies Gaussian smoothing independently to color channels. Loads input as
8-bit color; it does not preserve 16-bit depth or alpha.

```text
gaussian_cli input output [ksize] [sigmaX] [sigmaY]
```

Defaults: ksize=5 (odd 1-31), sigmaX=0, sigmaY=0 (both nonnegative).
Zero sigmaX derives sigma from kernel size; zero sigmaY uses sigmaX.

```sh
./cv-cli/cpp-gaussian/build/gaussian_cli img/one.png blurred.png 5 1.2 0
```

Workflow: [Gaussian](../../elements/gaussian.json), image input/output.
Free-form toolbar: **GAUSSIAN**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
