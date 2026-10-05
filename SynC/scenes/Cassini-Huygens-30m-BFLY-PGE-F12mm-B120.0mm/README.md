# Cassini Stereo Scene Defaults

`params.json` is the versioned description of the default Cassini stereo
scene. `cassini-stereo-pair.py` loads it by default; pass `--params PATH`
to use a different JSON parameter file.

This builder renders a static stereo pair, not an ingress trajectory. With
the default cameras, outputs are `cassini-stereo-pair.blend`,
`cassini-stereo-pair_blackfly_left.png`, and
`cassini-stereo-pair_blackfly_right.png`.

Scene loading and Blender setup are shared with the ingress driver through
[scene_config.py](../../pylib/scene_config.py) and
[scene_setup.py](../../pylib/scene_setup.py). See the
[shared schema reference](../../pylib/README.md). Output extensions follow
`scene.render.image_format`; the names above reflect the default PNG format.
This static driver rejects a `trajectory` section rather than ignoring it.

The builder accepts either EEVEE engine identifier (`BLENDER_EEVEE` or
`BLENDER_EEVEE_NEXT`) and reports when it substitutes the identifier supported
by the installed Blender version. Other unavailable engines raise an error.
The runner exits with a nonzero status if the Python script fails.

## Top-level sections

- `schema_version`: version of this JSON layout. Increment when making
  incompatible schema changes.
- `scene`: scene name, units, world coordinate frame, and render defaults.
- `camera_rig`: stereo baseline and camera intrinsics/poses.
- `environment`: background, Sun, additional lights, Earth/Moon options, and
  star-background options.
- `models`: model asset names and world poses.
- `trajectory`: optional in the shared schema, but executed only by the
  trajectory driver, not this static-pair driver.

## Coordinates and poses

Positions and model dimensions use meters. The right-handed world frame uses
`+X` right, `+Y` forward, and `+Z` up. Camera and model poses are represented
by `pose.translation_m` and `pose.rotation_euler_rad`; Euler angles are in
radians and use Blender's `XYZ` rotation order. The camera points along its
local `-Z` axis.

The camera entries intentionally do not repeat a `T` matrix alongside
translation and Euler rotation. That would store the same pose twice and
allow inconsistent values. When a downstream consumer needs a transform
matrix, derive it from the pose and document whether it is object-to-world,
world-to-camera, or expressed in Blender/OpenCV camera axes.

The stereo cameras are parallel and separated along world `X` by 0.12 m. Keep
their optical axes parallel when rectified stereo images are required.

## Environment assumptions

The Sun direction uses azimuth/elevation in degrees. Azimuth is zero along
world `+Y`, increases toward `+X`, and elevation is measured above the `XY`
plane. `vector_points` states that the direction is from the scene toward the
Sun. The renderer's light direction is the incoming ray direction, so a
consumer must account for that distinction when setting the Blender Sun
rotation.

`blender_energy` is a Blender render control, not a calibrated physical
irradiance value. Keep physical quantities, such as angular diameter and
eventual irradiance, separate from renderer-specific tuning.

Earth and Moon each have separate `visible` and `illumination.enabled` flags.
This allows a body to be hidden while still contributing approximate fill
light, or shown without adding illumination. Their positions, phase, and
reflectance are not yet modeled; those can be added with an ephemeris or
explicit pose later.

Stars are disabled by default. A future star implementation should define its
catalog or source data and an exposure/camera response model rather than
raising the world-background brightness indiscriminately.

On Blender versions without Sun temperature controls, setup reports the
unsupported setting and retains the default white Sun.

## Incremental development

Treat this file as scene input data, not executable Python: use JSON numbers
and arrays, not expressions such as `math.radians(90)`. Validate changes with
a JSON parser. The builder currently supports the listed camera, model,
render, background, Sun, and additional `SUN` light fields. Earth/Moon
visibility or illumination and visible stars are reserved but raise a clear
error until those features are implemented. Define coordinate-frame, units,
and rendering semantics before adding new consumed fields.
