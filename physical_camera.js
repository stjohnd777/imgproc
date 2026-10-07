import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);

function integer(value, name) {
    if (typeof value !== 'number' || !Number.isInteger(value) ||
        value < (name === 'device_id' ? 0 : 1) || value > 2147483647) {
        throw new Error(`Invalid ${name}: expected ${name === 'device_id' ? 'a nonnegative' : 'a positive'} 32-bit integer.`);
    }
    return value;
}

export async function capturePhysicalCamera(params, {
    executable, appDir, timeout, capture = execute
}) {
    const device = integer(params.device_id ?? 0, 'device_id');
    const count = integer(params.frame_count ?? 10, 'frame_count');
    const output = params.output_dir ?? '~/data/camera0';
    if (typeof output !== 'string' || !output.trim() || output.includes('\0')) {
        throw new Error('Invalid output_dir: expected a nonempty directory path.');
    }
    const text = output.trim();
    if (text.startsWith('~') && text !== '~' && !text.startsWith('~/')) {
        throw new Error('output_dir only supports ~ or ~/ for home-directory expansion.');
    }
    const expanded = text === '~' ? os.homedir()
        : text.startsWith('~/') ? path.join(os.homedir(), text.slice(2)) : text;
    const directory = path.resolve(appDir, expanded);
    try {
        await access(executable, constants.X_OK);
    } catch (error) {
        throw new Error(`Physical Camera executable is unavailable: ${executable}. Build it with ./build_cli.sh usb-camera.`, { cause: error });
    }
    await mkdir(directory, { recursive: true });
    const batchDir = await mkdtemp(path.join(directory, 'capture-'));
    try {
        // No height/width arguments: retain camera/backend-selected resolution.
        await capture(executable, [String(device), batchDir, String(count)], { timeout });
    } catch (error) {
        const detail = error.stderr?.trim() || error.message;
        throw new Error(`Physical Camera capture failed: ${detail}. Partial files, if any, remain in ${batchDir}. Check device availability and camera permissions.`, { cause: error });
    }
    const entries = await readdir(batchDir, { withFileTypes: true });
    const imageNames = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
    const files = Array.from({ length: count }, (_, index) =>
        path.join(batchDir, `frame_${String(index + 1).padStart(6, '0')}.png`));
    if (entries.length !== count || files.some(file => !imageNames.has(path.basename(file)))) {
        throw new Error(`Physical Camera expected ${count} numbered PNG frames in ${batchDir}; capture output was incomplete or unexpected.`);
    }
    return { batchDir, files };
}
