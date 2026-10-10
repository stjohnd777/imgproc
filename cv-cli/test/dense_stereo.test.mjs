import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { renderArgs } from '../../workflow_args.js';
import { nativeTool } from './tools.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const spec = JSON.parse(readFileSync(path.join(root, 'elements/dense_stereo.json')));
const executable = nativeTool(spec.exec.cli);
const defaults = Object.fromEntries(Object.entries(spec.params).map(([name, value]) => [name, value.default]));

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'dense-stereo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const files = {
        disparity: path.join(dir, 'disparity.json'), calibration: path.join(dir, 'q.json'),
        positionEstimate: path.join(dir, 'position.json'), points3d: path.join(dir, 'points.ply')
    };
    const data = {
        schemaVersion: 1, type: 'disparity', width: 5, height: 3,
        units: 'pixels', layout: 'row-major', invalidValue: null,
        disparities: Array(15).fill(null)
    };
    const calibration = {
        schemaVersion: 1, type: 'stereo_rectification', imageWidth: 5, imageHeight: 3,
        lengthUnits: 'm', referenceFrame: 'rectified_left_camera',
        cameraAxes: 'x_right_y_down_z_forward', disparityConvention: 'u_left_minus_u_right',
        Q: [[1, 0, 0, -2], [0, 1, 0, -1], [0, 0, 0, 100], [0, 0, 10, 0]]
    };
    const save = () => {
        writeFileSync(files.disparity, JSON.stringify(data));
        writeFileSync(files.calibration, JSON.stringify(calibration));
    };
    const run = (params = {}, mask = '') => {
        save();
        const args = renderArgs(spec.exec.args, {
            inputs: { disparity: files.disparity, calibration: files.calibration, mask },
            outputs: files, params: { ...defaults, minPoints: 1, ...params }
        });
        return spawnSync(executable, args, { encoding: 'utf8' });
    };
    const result = () => JSON.parse(readFileSync(files.positionEstimate));
    return { dir, files, data, calibration, save, run, result };
}

test('fractional disparity and Q reconstruct exact metric position, range, bearing, and PLY', t => {
    const f = fixture(t);
    f.data.disparities[7] = 0.1;
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const result = f.result();
    assert.equal(result.status, 'valid');
    assert.deepEqual(result.average_point3d, [0, 0, 100]);
    assert.equal(result.range_m, 100);
    assert.deepEqual(result.bearing_unit_vector, [0, 0, 1]);
    assert.equal(result.azimuth_deg, 0);
    assert.ok(result.elevation_deg === 0);
    assert.equal(result.pointCount, 1);
    assert.equal(result.rangeStatistics.meanM, 100);
    assert.match(readFileSync(f.files.points3d, 'utf8'), /element vertex 1[\s\S]*\n0 0 100\n$/);
});

test('mean position differs from mean surface range and angles use right/down/forward convention', t => {
    const f = fixture(t);
    f.data.disparities[3] = 0.5;
    f.data.disparities[9] = 1;
    assert.equal(f.run().status, 0);
    const result = f.result();
    assert.deepEqual(result.average_point3d, [0.2, -0.1, 15]);
    const expectedRange = Math.hypot(0.2, -0.1, 15);
    assert.ok(Math.abs(result.range_m - expectedRange) < 1e-12);
    assert.ok(result.rangeStatistics.meanM > result.range_m);
    assert.ok(result.azimuth_deg > 0);
    assert.ok(result.elevation_deg > 0);
    assert.ok(Math.abs(Math.hypot(...result.bearing_unit_vector) - 1) < 1e-12);
});

test('target mask, valid ROIs, and range/disparity limits exclude points with explicit counts', t => {
    const f = fixture(t);
    f.data.disparities.fill(0.1);
    const mask = path.join(f.dir, 'mask.pgm'), pixels = Buffer.alloc(15);
    pixels[7] = 255; pixels[8] = 255;
    writeFileSync(mask, Buffer.concat([Buffer.from('P5\n5 3\n255\n'), pixels]));
    assert.equal(f.run({}, mask).status, 0);
    assert.equal(f.result().pointCount, 2);
    assert.equal(f.result().counts.maskedOut, 13);
    f.calibration.validRoiLeft = { x: 2, y: 1, width: 1, height: 1 };
    assert.equal(f.run().status, 0);
    assert.equal(f.result().pointCount, 1);
    assert.equal(f.result().counts.outsideValidRoi, 14);
    assert.equal(f.run({ maxRangeM: 50 }).status, 0);
    assert.equal(f.result().counts.beyondRangeLimit, 1);
    assert.equal(f.run({ minDisparity: 0.1 }).status, 0);
    assert.equal(f.result().pointCount, 0);
});

test('zero/null disparities and insufficient points produce unavailable estimates, never finite success', t => {
    const f = fixture(t);
    f.data.disparities[7] = 0;
    let run = f.run();
    assert.equal(run.status, 0);
    assert.match(run.stderr, /estimate unavailable/);
    assert.equal(f.result().status, 'unavailable');
    for (const field of ['average_point3d', 'range_m', 'bearing_unit_vector', 'azimuth_deg', 'elevation_deg'])
        assert.equal(f.result()[field], null);
    assert.match(readFileSync(f.files.points3d, 'utf8'), /element vertex 0/);
    f.data.disparities[7] = 0.1;
    run = f.run({ minPoints: 2 });
    assert.equal(run.status, 0);
    assert.equal(f.result().status, 'unavailable');
    assert.equal(f.result().pointCount, 1);
    assert.equal(f.result().average_point3d, null);
});

test('invalid schemas, matrix, dimensions, mask, parameters, and outputs fail explicitly', t => {
    const f = fixture(t);
    for (const [modify, message] of [
        [() => { f.data.units = 'mm'; }, /numeric Disparity/],
        [() => { f.data.width = 6; }, /dimensions must match/],
        [() => { f.data.disparities = []; }, /array size/],
        [() => { f.data.disparities[0] = 'bad'; }, /finite numbers/],
        [() => { f.calibration.lengthUnits = 'mm'; }, /Unsupported rectification/],
        [() => { f.calibration.Q = Array.from({ length: 4 }, () => [0, 0, 0, 0]); }, /nondegenerate/]
    ]) {
        const beforeData = structuredClone(f.data), beforeCalibration = structuredClone(f.calibration);
        modify();
        const result = f.run();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        Object.assign(f.data, beforeData); Object.assign(f.calibration, beforeCalibration);
    }
    assert.notEqual(f.run({}, path.join(f.dir, 'missing.png')).status, 0);
    assert.match(f.run({ maxRangeM: NaN }).stderr, /finite/);
    f.files.points3d = path.join(f.dir, 'missing', 'cloud.ply');
    assert.match(f.run().stderr, /Dense Stereo failed/);
    assert.notEqual(spawnSync(executable, []).status, 0);
});

test('workflow executes numeric Disparity data and Q to both reconstruction artifacts', async t => {
    const f = fixture(t);
    f.data.disparities[7] = 0.1; f.save();
    const main = readFileSync(path.join(root, 'main.js'), 'utf8');
    const context = vm.createContext({
        path, mkdir, performance, renderArgs, TOOL_TIMEOUT_MS: 30000,
        resolveCli: name => nativeTool(name),
        executeCli: async (exe, args) => {
            const result = spawnSync(exe, args, { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
        }
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const steps = [
        ...['disparity', 'calibration'].map((name, i) => ({
            nodeId: name, elementId: 'source', name, order: i + 1, sources: {}, outputPorts: [{ name: 'text', type: 'text' }]
        })),
        { nodeId: 'dense', elementId: spec.id, name: spec.name, order: 3,
            params: { ...defaults, minPoints: 1 }, sources: {
                disparity: { nodeId: 'disparity', port: 'text' },
                calibration: { nodeId: 'calibration', port: 'text' }, mask: null
            }, outputPorts: spec.outputs }
    ];
    const results = await context.runFrame({
        steps, elements: new Map([['source', {}], [spec.id, spec]]),
        sourceFrames: new Map(['disparity', 'calibration'].map(name => [name, { repeat: true, files: [f.files[name]], port: 'text' }])),
        runDir: f.dir, frame: 1
    });
    assert.equal(results[2].artifacts.length, 2);
    assert.equal(JSON.parse(readFileSync(results[2].artifacts[0].path)).range_m, 100);
    assert.match(readFileSync(results[2].artifacts[1].path, 'utf8'), /element vertex 1/);
});

test('actual StereoSGBM data plus generated rectification Q recover a known 15 m plane', t => {
    const f = fixture(t), width = 192, height = 64, shift = 8;
    let seed = 123456789;
    const left = Buffer.alloc(width * height), right = Buffer.alloc(left.length);
    for (let i = 0; i < left.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        left[i] = seed >>> 24;
    }
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width - shift; x++) right[y * width + x] = left[y * width + x + shift];
    const header = Buffer.from(`P5\n${width} ${height}\n255\n`);
    const leftFile = path.join(f.dir, 'left.pgm'), rightFile = path.join(f.dir, 'right.pgm');
    writeFileSync(leftFile, Buffer.concat([header, left]));
    writeFileSync(rightFile, Buffer.concat([header, right]));
    const calibrationFile = path.join(f.dir, 'inputCalibration.json');
    const K = [[1000, 0, 95.5], [0, 1000, 31.5], [0, 0, 1]];
    writeFileSync(calibrationFile, JSON.stringify({
        schemaVersion: 1, type: 'stereo_calibration', imageWidth: width, imageHeight: height,
        lengthUnits: 'm', cameraAxes: 'x_right_y_down_z_forward',
        transformConvention: 'point_C2 = R * point_C1 + T',
        K1: K, K2: K, D1: [0, 0, 0, 0, 0], D2: [0, 0, 0, 0, 0],
        R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], T: [[-0.12], [0], [0]]
    }));
    const execute = (exe, args) => {
        const result = spawnSync(nativeTool(exe), args, { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
    };
    execute('cpp-stereo-calibration/build/stereo_rectify_cli', [
        calibrationFile, f.files.calibration, path.join(f.dir, 'leftMaps.json'), path.join(f.dir, 'rightMaps.json'), '-1'
    ]);
    execute('cpp-disparity/build/disparity_cli', [
        leftFile, rightFile, path.join(f.dir, 'preview.png'), f.files.disparity, '64', '9', '10', '0', '2'
    ]);
    const mask = Buffer.alloc(width * height), maskFile = path.join(f.dir, 'target.pgm');
    for (let y = 26; y < 38; y++) for (let x = 90; x < 102; x++) mask[y * width + x] = 255;
    writeFileSync(maskFile, Buffer.concat([header, mask]));
    const result = spawnSync(executable, [
        f.files.disparity, f.files.calibration, f.files.positionEstimate, f.files.points3d, '0.01', '10000', '10', maskFile
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const estimate = f.result();
    assert.equal(estimate.status, 'valid');
    assert.ok(estimate.pointCount >= 140);
    assert.ok(Math.abs(estimate.average_point3d[2] - 15) < 0.05);
    assert.ok(Math.abs(estimate.range_m - 15) < 0.05);
    assert.ok(Math.abs(estimate.azimuth_deg) < 0.05);
    assert.ok(Math.abs(estimate.elevation_deg) < 0.05);
});
