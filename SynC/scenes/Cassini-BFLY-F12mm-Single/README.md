# Cassini Single Image

This scene renders Cassini at 30 m with one Blackfly camera at the origin,
a 12 mm lens, and 1288 x 964 PNG output. It is static, not a stereo pair
or an ingress trajectory. Single-camera rigs have no stereo baseline fields.

Run from this directory:

```sh
./run.sh
./run.sh --output-dir /absolute/path/to/output
```

The default outputs are `cassini-single_blkfly.png`,
`cassini-single.blend`, and `render_manifest.json`. The output prefix can
be changed in [params.json](./params.json). `--params` selects another
schema-v1 configuration; this driver requires one camera and no trajectory.
The launcher forwards arguments to the shared-renderer wrapper.

For workflow use, select this [params.json](./params.json) in the
**Synthetic Scene** source and connect its image output to **UIView**.

See also:

- [Shared scene configuration](../../README.md#shared-scene-configuration)
- [Coordinates and camera conventions](../../README.md#coordinates-and-camera-conventions)
- [Lighting and environment](../../README.md#lighting-and-environment)
- [Detailed schema reference](../../pylib/README.md)
- [Universal renderer](../../README.md#universal-renderer)
- [Scene defaults](./params.json)
