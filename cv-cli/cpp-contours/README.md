# Contours CLI

Finds contours from a grayscale Canny edge image and draws them on a color
preview. This produces an image, not numeric contour geometry. Input is loaded
as 8-bit color.

```text
contours_cli input output [low] [high] [thickness] [externalOnly]
```

Defaults: low=80, high=180 (0-255), thickness=2 (1-20), externalOnly=1.
Set externalOnly=0 to include nested contours.

```sh
./cv-cli/cpp-contours/build/contours_cli img/one.png contours.png 80 180 2 1
```

Workflow: [Contours](../../elements/contours.json), image input/output.
Free-form toolbar: **CONTOURS**, executable wired.
Build and positional conventions: [CLI reference](../README.md).
