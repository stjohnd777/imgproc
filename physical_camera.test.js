import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { capturePhysicalCamera } from './physical_camera.js';

async function fixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'physical-camera-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

function options(directory, capture) {
    return { executable: process.execPath, appDir: directory, timeout: 1234, capture };
}

test('element declares dialog defaults and an image source output', async () => {
    const element = JSON.parse(await readFile(new URL('./elements/physical_camera_source.json', import.meta.url), 'utf8'));
    assert.equal(element.kind, 'source');
    assert.equal(element.exec.builtin, 'physical_camera_source');
    assert.equal(element.params.device_id.default, 0);
    assert.equal(element.params.output_dir.default, '~/data/camera0');
    assert.equal(element.params.frame_count.default, 10);
    assert.equal(element.params.output_dir.type, 'folder');
    assert.deepEqual(element.outputs, [{ name: 'image', type: 'image' }]);
    assert.equal(element.params.height, undefined);
    assert.equal(element.params.width, undefined);
});

test('captures the requested finite batch with no resolution arguments', async t => {
    const directory = await fixture(t);
    const output = path.join(directory, 'camera0');
    await mkdir(output);
    await writeFile(path.join(output, 'old.png'), 'old');
    const capture = async (exe, args, settings) => {
        assert.equal(exe, process.execPath);
        assert.equal(args.length, 3);
        assert.equal(args[0], '0');
        assert.equal(args[2], '10');
        assert.equal(settings.timeout, 1234);
        for (let i = 1; i <= 10; ++i) {
            await writeFile(path.join(args[1], `frame_${String(i).padStart(6, '0')}.png`), 'frame');
        }
    };
    const first = await capturePhysicalCamera({ output_dir: output }, options(directory, capture));
    const second = await capturePhysicalCamera({ output_dir: output }, options(directory, capture));
    assert.notEqual(first.batchDir, second.batchDir);
    assert.equal(first.files.length, 10);
    assert.equal(path.basename(first.files[9]), 'frame_000010.png');
    assert(first.files.every(file => path.dirname(file) === first.batchDir));
});

test('rejects invalid parameters before invoking capture', async t => {
    const directory = await fixture(t);
    for (const params of [
        { device_id: -1 }, { device_id: 0.5 }, { device_id: '0' },
        { frame_count: -1 }, { frame_count: 0 }, { frame_count: 1.5 },
        { frame_count: NaN }, { output_dir: '' }, { output_dir: '~someone/data' }
    ]) {
        await assert.rejects(capturePhysicalCamera(params, options(directory, () => {
            assert.fail('Capture must not be invoked');
        })));
    }
});

test('reports subprocess errors and partial-output location', async t => {
    const directory = await fixture(t);
    await assert.rejects(
        capturePhysicalCamera({ output_dir: 'camera0' }, options(directory, async () => {
            throw Object.assign(new Error('exit 2'), { stderr: 'Camera unavailable' });
        })),
        /Camera unavailable.*Partial files.*capture-/
    );
});

test('rejects incomplete output and missing executable', async t => {
    const directory = await fixture(t);
    await assert.rejects(capturePhysicalCamera(
        { output_dir: 'camera0', frame_count: 2 },
        options(directory, async () => {})
    ), /incomplete or unexpected/);
    await assert.rejects(capturePhysicalCamera(
        { output_dir: 'camera0' },
        { ...options(directory), executable: path.join(directory, 'missing') }
    ), /build_cli.sh usb-camera/);
});
