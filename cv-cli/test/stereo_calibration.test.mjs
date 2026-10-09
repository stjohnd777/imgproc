import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { renderArgs } from '../../workflow_args.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const build = path.join(root, 'cv-cli/cpp-stereo-calibration/build');
const calibrate = path.join(build, 'stereo_calibrate_cli');
const rectify = path.join(build, 'stereo_rectify_cli');
const remap = path.join(root, 'cv-cli/cpp-remap/build/remap_cli');
const element = name => JSON.parse(readFileSync(path.join(root, `elements/${name}.json`)));
const ideal = {
    schemaVersion: 1, type: 'stereo_calibration', imageWidth: 640, imageHeight: 480,
    lengthUnits: 'm', cameraAxes: 'x_right_y_down_z_forward',
    transformConvention: 'point_C2 = R * point_C1 + T',
    K1: [[700, 0, 319.5], [0, 700, 239.5], [0, 0, 1]],
    K2: [[700, 0, 319.5], [0, 700, 239.5], [0, 0, 1]],
    D1: [0, 0, 0, 0, 0], D2: [0, 0, 0, 0, 0],
    R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], T: [[-0.12], [0], [0]]
};

function directory(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'stereo-calibration-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function run(exe, args) {
    const result = spawnSync(exe, args.map(String), { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
}
function rectificationPaths(dir) {
    return ['calibration.json', 'rectification.json', 'leftMaps.json', 'rightMaps.json'].map(name => path.join(dir, name));
}

test('known parallel synthetic calibration produces metric Q and maps directly readable by Remap', t => {
    const dir = directory(t);
    const [input, output, leftMaps, rightMaps] = rectificationPaths(dir);
    writeFileSync(input, JSON.stringify(ideal));
    run(rectify, [input, output, leftMaps, rightMaps, -1]);
    const result = JSON.parse(readFileSync(output));
    assert.equal(result.referenceFrame, 'rectified_left_camera');
    assert.equal(result.lengthUnits, 'm');
    assert.ok(Math.abs(result.Q[3][2] - 1 / 0.12) < 1e-10);
    const homogeneous = result.Q.map(row => row.reduce((sum, value, index) => sum + value * [319.5, 239.5, 0.84, 1][index], 0));
    assert.deepEqual(homogeneous.slice(0, 2), [0, 0]);
    assert.ok(Math.abs(homogeneous[2] / homogeneous[3] - 100) < 1e-9);
    for (const maps of [leftMaps, rightMaps]) {
        const stored = JSON.parse(readFileSync(maps));
        assert.equal(stored.map_x.rows, 480);
        assert.equal(stored.map_y.cols, 640);
        assert.equal(stored.map_x.dt, 'f');
        assert.ok(Math.abs(stored.map_x.data[100] - 100) < 1e-5);
        assert.ok(Math.abs(stored.map_y.data[640] - 1) < 1e-5);
    }
    const source = path.join(dir, 'image.pgm');
    const pixels = Buffer.alloc(640 * 480);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
    writeFileSync(source, Buffer.concat([Buffer.from('P5\n640 480\n255\n'), pixels]));
    const remapped = path.join(dir, 'remapped.pgm');
    run(remap, [source, remapped, leftMaps, '', 'nearest', 'constant']);
    assert.deepEqual(readFileSync(remapped).subarray(-pixels.length), pixels);
});

test('checkerboard folders calibrate known geometry and feed rectification through workflow execution', async t => {
    const dir = directory(t);
    run(path.join(build, 'stereo_calibration_fixture'), [dir]);
    const main = readFileSync(path.join(root, 'main.js'), 'utf8');
    const context = vm.createContext({
        path, mkdir, performance, renderArgs, TOOL_TIMEOUT_MS: 120000,
        isInAllowedFolder: filename => filename.startsWith(dir + path.sep),
        resolveCli: filename => path.join(root, 'cv-cli', filename),
        executeCli: async (filename, args) => run(filename, args)
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const calibrationSpec = element('stereo_calibrate'), rectSpec = element('stereo_rectify');
    const params = {
        leftDir: path.join(dir, 'left'), rightDir: path.join(dir, 'right'),
        columns: 9, rows: 6, squareSizeM: 0.035, minPairs: 8
    };
    const steps = [
        { nodeId: 'calibrate', elementId: calibrationSpec.id, name: calibrationSpec.name, order: 1,
            params, sources: {}, outputPorts: calibrationSpec.outputs },
        { nodeId: 'rectify', elementId: rectSpec.id, name: rectSpec.name, order: 2,
            params: { alpha: 0, calibrationFile: '' }, sources: { calibration: { nodeId: 'calibrate', port: 'calibration' } },
            outputPorts: rectSpec.outputs }
    ];
    const options = { steps, elements: new Map([[calibrationSpec.id, calibrationSpec], [rectSpec.id, rectSpec]]),
        sourceFrames: new Map(), runDir: dir, frame: 1 };
    const results = await context.runFrame(options);
    const input = results[0].output;
    const result = JSON.parse(readFileSync(input));
    assert.ok(result.acceptedPairs.length >= 8);
    assert.ok(result.rmsPixels.stereo < 1, `RMS ${result.rmsPixels.stereo}`);
    assert.ok(Math.abs(result.baselineM - 0.12) < 0.006, `Baseline ${result.baselineM}`);
    assert.ok(Math.abs(result.K1[0][0] - 700) < 70);
    assert.ok(Math.abs(result.K2[0][0] - 700) < 70);
    assert.ok(result.T[0][0] < 0);
    assert.ok(JSON.parse(readFileSync(results[1].output)).Q[3][2] > 0);
    assert.equal(results[1].artifacts.length, 3);
    params.leftDir = path.join(tmpdir(), 'not-authorized-for-test');
    await assert.rejects(context.runFrame(options), /authorized leftDir/);
});

test('calibration rejects bad pair sets and insufficient detections with explicit diagnostics', t => {
    const dir = directory(t), left = path.join(dir, 'left'), right = path.join(dir, 'right');
    mkdirSync(left); mkdirSync(right);
    const blank = Buffer.concat([Buffer.from('P5\n64 64\n255\n'), Buffer.alloc(4096)]);
    writeFileSync(path.join(left, 'one.pgm'), blank);
    const args = [left, right, path.join(dir, 'out.json')];
    let result = spawnSync(calibrate, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No supported images/);
    writeFileSync(path.join(right, 'two.pgm'), blank);
    result = spawnSync(calibrate, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unmatched right image/);
    rmSync(path.join(right, 'two.pgm'));
    writeFileSync(path.join(right, 'one.pgm'), blank);
    result = spawnSync(calibrate, args, { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Rejected pair.*checkerboard/);
    assert.match(result.stderr, /Insufficient accepted/);
    result = spawnSync(calibrate, [...args, '9', '6', 'nan'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /finite/);
});

test('rectification rejects wrong units, transforms, camera order, dimensions and write errors', t => {
    const dir = directory(t), paths = rectificationPaths(dir);
    for (const [override, message] of [
        [{ lengthUnits: 'mm' }, /schema, units/],
        [{ T: [[0], [0], [0]] }, /nonzero baseline/],
        [{ T: [[0.12], [0], [0]] }, /camera order/],
        [{ T: [[0], [-0.12], [0]] }, /horizontal stereo/],
        [{ R: [[2, 0, 0], [0, 1, 0], [0, 0, 1]] }, /proper rotation/],
        [{ imageWidth: 0 }, /between 1/],
        [{ K1: [[0, 0, 0], [0, 700, 0], [0, 0, 1]] }, /positive focal/],
        [{ D1: [0, 0] }, /must contain/],
        [{ T: [-0.12, 0, 0] }, /column count/]
    ]) {
        writeFileSync(paths[0], JSON.stringify({ ...ideal, ...override }));
        const result = spawnSync(rectify, paths, { encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
    }
    writeFileSync(paths[0], JSON.stringify(ideal));
    const result = spawnSync(rectify, [paths[0], path.join(dir, 'missing', 'out.json'), ...paths.slice(2)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stereo rectification failed/);
});

test('workflow plan preserves optional inputs and runner produces calibration maps connected to Remap', async t => {
    const dir = directory(t), [input] = rectificationPaths(dir);
    writeFileSync(input, JSON.stringify(ideal));
    const pixels = Buffer.alloc(640 * 480, 123), source = path.join(dir, 'image.pgm');
    writeFileSync(source, Buffer.concat([Buffer.from('P5\n640 480\n255\n'), pixels]));
    const main = readFileSync(path.join(root, 'main.js'), 'utf8');
    const context = vm.createContext({
        path, mkdir, stat, performance, randomUUID, renderArgs,
        RUNS_DIR: dir, allowedFolders: new Set(), TOOL_TIMEOUT_MS: 120000,
        isInAllowedFolder: filename => filename.startsWith(dir + path.sep),
        resolveCli: filename => path.join(root, 'cv-cli', filename),
        executeCli: async (filename, args) => run(filename, args)
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// --- Running a workflow')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const rectSpec = element('stereo_rectify'), mapSpec = element('remap');
    const node = (id, spec, params) => ({ id, name: spec.name ?? id, elementId: spec.id ?? id,
        inputs: spec.inputs ?? [], outputs: spec.outputs ?? [], params });
    const rectNode = node('rect', rectSpec, { calibrationFile: input, alpha: -1 });
    const imageNode = node('source', { outputs: [{ name: 'image', type: 'image' }] }, {});
    const mapNode = node('remap', mapSpec, { map_x: 'identity', map_y: '', interpolation: 'nearest', borderMode: 'constant' });
    const graph = { nodes: [rectNode, imageNode, mapNode], edges: [
        { from: { nodeId: 'source', port: 'image' }, to: { nodeId: 'remap', port: 'image' } },
        { from: { nodeId: 'rect', port: 'leftMaps' }, to: { nodeId: 'remap', port: 'maps' } }
    ] };
    const plan = await context.prepareWorkflowRun({ name: 'rectify', graph });
    assert.equal(plan.runnable, true, JSON.stringify(plan.problems));
    const results = await context.runFrame({
        steps: plan.steps, elements: new Map([[rectSpec.id, rectSpec], ['source', {}], [mapSpec.id, mapSpec]]),
        sourceFrames: new Map([['source', { repeat: true, files: [source], port: 'image' }]]),
        runDir: plan.runDir, frame: 1
    });
    assert.equal(results[0].artifacts.length, 3);
    for (const artifact of results[0].artifacts) assert.ok(existsSync(artifact.path));
    assert.ok(existsSync(results[2].output));
    graph.edges.pop();
    const oldPlan = await context.prepareWorkflowRun({ name: 'legacy-remap', graph });
    assert.equal(oldPlan.runnable, true, JSON.stringify(oldPlan.problems));
    const missingImagePlan = await context.prepareWorkflowRun({ graph: { nodes: [mapNode], edges: [] } });
    assert.equal(missingImagePlan.runnable, false);
    assert.match(missingImagePlan.problems[0], /image/);
});

test('input-to-parameter argument fallback preserves presets and prefers connected calibration/maps', () => {
    assert.deepEqual(renderArgs(['{in.maps|param.map_x}'], {
        inputs: {}, outputs: {}, params: { map_x: 'identity' }
    }), ['identity']);
    assert.deepEqual(renderArgs(['{in.maps|param.map_x}'], {
        inputs: { maps: '/generated.json' }, outputs: {}, params: { map_x: 'identity' }
    }), ['/generated.json']);
});
