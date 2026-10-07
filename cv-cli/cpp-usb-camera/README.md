# USB Camera CLI

Headless OpenCV camera capture to numbered PNG files.

```text
usb_camera_cli <device_id> <output_dir> [frame_count] [height width]
```

Examples, from the repository root with the configured VS Code build:

```bash
# Save 100 frames from camera index 0:
./build/cpp-usb-camera/usb_camera_cli 0 ./captures/run-001 100

# Capture continuously with a requested 640 x 480 resolution:
./build/cpp-usb-camera/usb_camera_cli 0 ./captures/run-002 -1 480 640
```

- Camera index is required and nonnegative; use `0` for the usual default.
- Frame count defaults to `-1` (continuous). Otherwise it must be positive.
- Optional dimensions are **height, then width**, and must both be supplied.
  Camera backends may reject or adjust requested sizes; the CLI reports
  warnings and prints the actual first-frame size. It does not resize frames.
- Images are `frame_000001.png`, `frame_000002.png`, and so on. The directory
  is created if needed. Existing frame filenames cause an error rather than
  being overwritten. Use one process per output directory.
- Ctrl+C or SIGTERM requests shutdown; a backend-blocked camera read may
  delay it. There is no GUI preview or Escape-key handling.
- Capture runs at the rate the camera/backend supplies frames, limited by
  synchronous PNG encoding and disk writes; no FPS or timing guarantees.
- Usage errors and camera/read/write failures exit nonzero. A read failure
  after partial capture retains already-written frames and reports failure.
  Interrupted capture exits successfully with the saved-frame count.

`cv::CAP_ANY` selects an available platform backend. Hardware support and
camera permissions are platform-dependent (including macOS camera privacy
permissions); device discovery and backend selection are not implemented.

Build using VS Code CMake Tools. CTest includes synthetic frame capture,
file-output, cancellation, and CLI argument checks, without opening a camera.
Actual camera capture must be verified with a connected device.

CLI parsing and parameter checks are centralized in `validate`, which fills
a local `Parameters` struct only after validation succeeds. Capture uses that
struct rather than reading `argv` or mutable global parameters. The signal
shutdown flag is the only global state; signal-handler setup and camera
operations remain runtime responsibilities.

## Workflow source

The **Physical Camera** element captures a finite batch before processing it.
Its dialog defaults are device ID `0`, output directory `~/data/camera0`,
and frame count `10`. Resolution is left to the camera/backend.
Each workflow execution creates a unique `capture-*` subdirectory and feeds
only that batch through its `image` output. Existing captures are retained.
Continuous (`-1`) capture is intentionally unavailable in this capture-first
workflow mode. Capture failures/timeouts stop the workflow and preserve
partial files; the timeout uses `toolTimeoutMs` from the app settings.

Build the workflow executable with `./build_cli.sh usb-camera`; it is expected
at `cv-cli/cpp-usb-camera/build/usb_camera_cli`. If that binary is absent,
the app uses the VS Code build at `build/cpp-usb-camera/usb_camera_cli`.
On macOS, camera access also requires the applicable privacy
permission for the launching application.
