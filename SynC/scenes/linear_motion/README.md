# Cassini diagonal linear motion

A fixed Blackfly camera views Cassini moving from outside the upper-left
corner, through the image center, and out through the lower-right corner.
The sequence begins and ends with Cassini fully outside the image.

Run from this directory:

```sh
./run.sh
```

The launcher uses the shared [universal renderer](../../pylib/render_scene.py)
and [scene JSON](./params.json), not a separate scene-building implementation.
Blender defaults to the macOS application path and falls back to `blender`
on PATH. Forwarded options include `--dry-run`, `--output-dir`, `--models-dir`,
`--azimuth`, and `--elevation`.

## Defaults

- One fixed camera, `BlkFly`, at the world origin, looking along +Y with +Z up.
- Blackfly 12 mm lens and 4.83 x 3.615 mm sensor.
- 1288 x 964 RGB, 8-bit PNG, 64 EEVEE samples.
- Cassini maintains its orientation and world Y = 100 m; only X and Z change.
- Start: `[-26, 100, 19.459627329192546]` m.
- End: `[26, 100, -19.459627329192546]` m.
- Maximum spatial step: 0.5 m, yielding 131 frames including both endpoints.
- Fixed Sun and fill light; black background, no Earth, Moon, or stars.

For this camera, +X moves right and +Z moves up in the image. The Z/X
ratio is chosen from the image aspect ratio (964/1288), putting the model
origin's projected path on the corner-to-corner diagonal. The model has
finite size, so portions enter/exit before/after its origin crosses a corner.
Endpoints extend beyond the field of view to include empty background.

Changing optics, resolution aspect ratio, distance, model scale, or orientation
can change corner crossings and endpoint visibility. Adjust the trajectory
accordingly; there is no automatic camera tracking or framing.

## Outputs

```text
output/
  cassini_linear_motion.blend
  ground_truth_trajectory.json
  frames/
    frame_0001.png
    ...
    frame_0131.png
```

The manifest records ordered images, model positions, and camera/model
transforms. The blend file contains the initial scene; motion is sampled by
the renderer rather than baked as Blender animation keyframes.

This configuration samples distance, not time: no FPS or speed is assigned.
A future video step can choose a playback rate. Use a fresh output directory
when changing frame count; the renderer does not remove older frames.

In Orbital Eyes, choose this JSON in **Synthetic Scene**, select `BlkFly`, and
connect its output to UIView or processing nodes. Existing Synthetic Camera
ingress is a different stereo source. Automatic previous-frame differencing
and video generation are outside this scene's scope.

## Verification

From the repository root, run the focused Blender test:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python-exit-code 1 --python SynC/tests/test_linear_motion.py
```

It checks all 131 trajectory projections and fixed camera transforms, then
renders five quarter-resolution samples to verify empty endpoints and visible
motion from upper-left to lower-right. Temporary outputs are removed.
