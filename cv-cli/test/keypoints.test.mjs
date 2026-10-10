import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyPoint } from '../../domain.js';
import { nativeTool } from './tools.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

for (const detector of ['sift', 'orb', 'fast', 'kaze', 'brisk', 'corners', 'surf']) {
    test(`${detector}: paired outputs, workflow parameters, empty detections and write errors`, t => {
        const dir = mkdtempSync(path.join(tmpdir(), 'keypoints-'));
        t.after(() => rmSync(dir, { recursive: true, force: true }));
        const spec = JSON.parse(readFileSync(path.join(root, 'elements', `${detector}.json`)));
        const exe = nativeTool(spec.exec.cli);
        const input = path.join(root, 'img', 'one.png');
        const preview = path.join(dir, '01_detector__preview.png');
        const jsonPath = path.join(dir, '01_detector__keypoints.json');
        const params = Object.fromEntries(Object.entries(spec.params).map(([k, v]) => [k, v.default]));
        const args = spec.exec.args.map(arg => {
            if (arg === '{in.image}') return input;
            if (arg === '{out.preview}') return preview;
            if (arg === '{out.keypoints}') return jsonPath;
            const value = params[arg.match(/^\{param\.(.+)\}$/)?.[1]];
            assert.notEqual(value, undefined, `unresolved argument ${arg}`);
            return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
        });
        if (detector === 'surf' && !existsSync(exe)) {
            t.skip('SURF tool not built (vcpkg builds omit opencv_contrib nonfree)');
            return;
        }
        const first = spawnSync(exe, args, { encoding: 'utf8' });
        if (detector === 'surf' && first.status === 4 && first.stderr.includes('SURF unavailable')) {
            t.skip('Installed OpenCV does not enable SURF nonfree support');
            return;
        }
        assert.equal(first.status, 0, first.stderr || first.error?.message);
        assert.ok(existsSync(preview));
        const result = JSON.parse(readFileSync(jsonPath));
        assert.equal(result.schemaVersion, 1);
        assert.equal(result.type, 'keypoints');
        assert.equal(result.detector, detector === 'corners' ? 'SHI_TOMASI' : detector.toUpperCase());
        assert.equal(result.count, result.keypoints.length);
        assert.equal(result.image.path, input);
        assert.equal(result.preview.path, preview);
        assert.equal(result.descriptors, null);
        assert.deepEqual(result.parameters, params);
        for (const [id, point] of result.keypoints.entries()) {
            assert.equal(point.id, id);
            assert.ok(point.u >= 0 && point.u < result.image.width);
            assert.ok(point.v >= 0 && point.v < result.image.height);
            assert.equal(point.descriptorRow, null);
            assert.deepEqual(JSON.parse(JSON.stringify(new KeyPoint(point))), point);
        }
        // Omitted JSON path always produces a predictable sidecar, including empty detections.
        const blank = path.join(dir, 'blank.pgm');
        writeFileSync(blank, Buffer.concat([Buffer.from('P5\n128 128\n255\n'), Buffer.alloc(128 * 128)]));
        const blankPreview = path.join(dir, 'blank.png');
        execFileSync(exe, [blank, blankPreview]);
        const empty = JSON.parse(readFileSync(path.join(dir, 'blank.keypoints.json')));
        assert.equal(empty.count, 0);
        assert.deepEqual(empty.keypoints, []);
        // An empty placeholder selects the same sidecar convention without shifting parameters.
        execFileSync(exe, [blank, blankPreview, '', ...args.slice(3)]);
        assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'blank.keypoints.json'))).parameters, params);
        const failed = spawnSync(exe, [input, preview, path.join(dir, 'missing', 'out.json'), ...args.slice(3)]);
        assert.equal(failed.status, 3);
        assert.match(failed.stderr.toString(), /Failed to write keypoints JSON/);
    });
}
