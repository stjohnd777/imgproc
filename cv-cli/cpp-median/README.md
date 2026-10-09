# Median CLI

Replaces each channel value with the neighborhood median, useful for
impulse/salt-and-pepper noise. Input is loaded as 8-bit color; alpha and 16-bit
source depth are not preserved.

```text
median_cli input output [ksize]
```

Default ksize=5; must be odd, 3-31.

```sh
./cv-cli/cpp-median/build/median_cli img/one.png median.png 5
```

Workflow: [Median](../../elements/median.json), image input/output.
Free-form toolbar: **MEDIAN**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
