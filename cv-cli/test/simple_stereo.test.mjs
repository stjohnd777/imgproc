import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeTool } from './tools.mjs';

const executable = nativeTool('cpp-simple-stereo/build/simple_stereo_cli');

function stereoFixture(t, shift) {
    const directory = mkdtempSync(path.join(tmpdir(), 'simple-stereo-coordinates-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const width = 64, height = 32;
    let seed = 123456789;
    const left = Buffer.alloc(width * height);
    for (let i = 0; i < left.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        left[i] = seed >>> 24;
    }
    const right = Buffer.alloc(left.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - shift; x++) right[y * width + x] = left[y * width + x + shift];
    }
    const imageL = path.join(directory, 'left.pgm'), imageR = path.join(directory, 'right.pgm');
    const header = Buffer.from(`P5\n${width} ${height}\n255\n`);
    writeFileSync(imageL, Buffer.concat([header, left]));
    writeFileSync(imageR, Buffer.concat([header, right]));
    return keypoints => {
        const input = path.join(directory, 'keypoints.json');
        const matches = path.join(directory, 'matches.json');
        const points = path.join(directory, 'points.ply');
        const estimate = path.join(directory, 'estimate.json');
        writeFileSync(input, JSON.stringify({ keypoints }));
        const result = spawnSync(executable, [
            imageL, imageR, input, path.join(directory, 'preview.png'), matches, points,
            '8', '3', '0', '0.99', '120', '1000', '800', '10', '5', estimate
        ], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.error?.message ?? result.stderr);
        return {
            matches: JSON.parse(readFileSync(matches, 'utf8')).matches,
            estimate: JSON.parse(readFileSync(estimate, 'utf8')),
            ply: readFileSync(points, 'utf8')
        };
    };
}

test('identical images with fractional keypoints have zero disparity and no false 3D estimate', t => {
    const run = stereoFixture(t, 0);
    const { matches, estimate, ply } = run([
        { id: 1, u: 24.25, v: 15.25 }, { id: 2, u: 24.75, v: 15.75 }
    ]);
    assert.equal(matches.length, 2);
    for (const [index, match] of matches.entries()) {
        assert.deepEqual(match.left, { u: 24 + index, v: 15 + index });
        assert.deepEqual(match.right, match.left);
        assert.equal(match.disparity, 0);
        assert.equal(match.point3d, null);
        assert.equal(match.point3d_mm, null);
    }
    assert.equal(estimate.average_point3d, null);
    assert.deepEqual(estimate.point_cloud, []);
    assert.match(ply, /element vertex 0/);
});

test('known integer shift uses patch-center coordinates for disparity and all triangulated axes', t => {
    const run = stereoFixture(t, 4);
    const fractional = run([{ id: 7, u: 24.25, v: 15.75 }]);
    const integer = run([{ id: 7, u: 24, v: 16 }]);
    assert.deepEqual(fractional.matches, integer.matches);
    assert.deepEqual(fractional.estimate, integer.estimate);
    const match = fractional.matches[0];
    assert.deepEqual(match.left, { u: 24, v: 16 });
    assert.deepEqual(match.right, { u: 20, v: 16 });
    assert.equal(match.disparity, 4);
    assert.deepEqual(match.point3d_mm, { x: 420, y: 412.5, z: 30000 });
    assert.deepEqual(fractional.estimate.average_point3d, [0.42, 0.4125, 30]);
});
