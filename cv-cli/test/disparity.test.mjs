import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { mkdir, stat } from 'node:fs/promises';
import { renderArgs } from '../../workflow_args.js';
import { uiViewResult } from '../../ui_view.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const element = JSON.parse(readFileSync(path.join(root, 'elements/disparity.json')));
const executable = path.join(root, 'cv-cli', element.exec.cli);
const defaults = Object.fromEntries(Object.entries(element.params).map(([name, spec]) => [name, spec.default]));

function fixture(t, shift = 8) {
    const dir = mkdtempSync(path.join(tmpdir(), 'disparity-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const width = 192, height = 64;
    let seed = 123456789;
    const left = Buffer.alloc(width * height), right = Buffer.alloc(left.length);
    for (let i = 0; i < left.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        left[i] = seed >>> 24;
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - shift; x++) right[y * width + x] = left[y * width + x + shift];
    }
    const paths = { left: path.join(dir, 'left.pgm'), right: path.join(dir, 'right.pgm'),
        disparity: path.join(dir, 'preview.png'), data: path.join(dir, 'data.json') };
    const header = Buffer.from(`P5\n${width} ${height}\n255\n`);
    writeFileSync(paths.left, Buffer.concat([header, left]));
    writeFileSync(paths.right, Buffer.concat([header, right]));
    return { paths, dir, width, height };
}

function argsFor(paths, params = defaults) {
    return element.exec.args.map(argument => {
        const [, group, name] = argument.match(/^\{(in|out|param)\.(.+)\}$/);
        const value = group === 'param' ? params[name] : paths[name];
        assert.notEqual(value, undefined, `Unresolved CLI argument: ${argument}`);
        return String(value);
    });
}

test('workflow defaults execute dense stereo and preserve numeric disparity and invalid pixels', t => {
    const { paths, width, height } = fixture(t);
    const result = spawnSync(executable, argsFor(paths), { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.ok(existsSync(paths.disparity));
    assert.equal(readFileSync(paths.disparity).subarray(1, 4).toString(), 'PNG');
    const data = JSON.parse(readFileSync(paths.data));
    assert.equal(data.algorithm, 'StereoSGBM');
    assert.equal(data.units, 'pixels');
    assert.deepEqual(data.parameters, defaults);
    assert.equal(data.disparities.length, width * height);
    assert.equal(data.validCount, data.disparities.filter(value => value !== null).length);
    assert.equal(data.disparities[0], null);
    const interior = [];
    for (let y = 12; y < height - 12; y++) {
        for (let x = 80; x < width - 20; x++) interior.push(data.disparities[y * width + x]);
    }
    assert.ok(interior.filter(value => value !== null && Math.abs(value - 8) <= 0.125).length / interior.length > 0.98);
});

test('identical images keep valid zero disparities distinct from invalid values', t => {
    const { paths } = fixture(t, 0);
    const result = spawnSync(executable, argsFor(paths), { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(readFileSync(paths.data));
    assert.ok(data.disparities.includes(null));
    assert.ok(data.disparities.includes(0));
});

test('frame runner executes the element and delivers image and numeric outputs to viewers', async t => {
    const { paths, dir } = fixture(t);
    const main = readFileSync(path.join(root, 'main.js'), 'utf8');
    const context = vm.createContext({
        path, mkdir, stat, performance, renderArgs, uiViewResult, TOOL_TIMEOUT_MS: 30000,
        IMAGE_EXTENSIONS: new Set(['.png']),
        isInAllowedFolder: filename => filename.startsWith(dir + path.sep),
        resolveCli: filename => path.join(root, 'cv-cli', filename),
        executeCli: async (filename, args) => {
            const result = spawnSync(filename, args, { encoding: 'utf8' });
            assert.equal(result.status, 0, result.error?.message ?? result.stderr);
        }
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const steps = [
        ...['left', 'right'].map((name, index) => ({
            nodeId: name, elementId: 'source', name, order: index + 1,
            sources: {}, outputPorts: [{ name: 'image', type: 'image' }]
        })),
        { nodeId: 'matcher', elementId: element.id, name: element.name, order: 3,
            params: defaults, sources: { left: { nodeId: 'left', port: 'image' }, right: { nodeId: 'right', port: 'image' } },
            outputPorts: element.outputs },
        ...element.outputs.map((port, index) => ({
            nodeId: port.name, elementId: port.type === 'text' ? 'textViewer' : 'imageViewer',
            name: port.name, order: index + 4,
            sources: { [port.type === 'text' ? 'text' : 'image']: { nodeId: 'matcher', port: port.name } }, outputPorts: []
        }))
    ];
    const results = await context.runFrame({
        steps, elements: new Map([
            ['source', {}], [element.id, element],
            ['textViewer', { exec: { builtin: 'ui_view_text' } }],
            ['imageViewer', { exec: { builtin: 'ui_view' } }]
        ]),
        sourceFrames: new Map(['left', 'right'].map(name => [name, { repeat: true, files: [paths[name]], port: 'image' }])),
        runDir: dir, frame: 1
    });
    assert.equal(results[2].artifacts.length, 2);
    for (const artifact of results[2].artifacts) assert.ok(existsSync(artifact.path));
    assert.equal(results[3].output, results[2].artifacts[0].path);
    assert.equal(results[4].output, results[2].artifacts[1].path);
    assert.equal(JSON.parse(readFileSync(results[4].output)).algorithm, 'StereoSGBM');
});

test('CLI rejects invalid configuration, inputs, and output paths explicitly', t => {
    const { paths, dir } = fixture(t);
    for (const [name, value, message] of [
        ['numDisparities', 17, /multiple of 16/], ['numDisparities', 64.5, /whole number/],
        ['blockSize', 8, /odd number/], ['uniquenessRatio', -1, /allowed range/],
        ['speckleWindowSize', -1, /allowed range/], ['speckleRange', -1, /allowed range/],
        ['numDisparities', 192, /too small/]
    ]) {
        const result = spawnSync(executable, argsFor(paths, { ...defaults, [name]: value }), { encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
    }
    const small = path.join(dir, 'small.pgm');
    writeFileSync(small, Buffer.concat([Buffer.from('P5\n32 32\n255\n'), Buffer.alloc(32 * 32)]));
    const sixteenBit = path.join(dir, 'sixteen.pgm');
    writeFileSync(sixteenBit, Buffer.concat([Buffer.from('P5\n192 64\n65535\n'), Buffer.alloc(192 * 64 * 2)]));
    for (const [overrides, message] of [
        [{ right: small }, /dimensions must match/],
        [{ left: sixteenBit }, /8-bit/],
        [{ left: path.join(dir, 'missing.png') }, /Cannot read/],
        [{ disparity: path.join(dir, 'missing', 'preview.png') }, /write disparity preview/],
        [{ data: path.join(dir, 'missing', 'data.json') }, /Disparity failed/]
    ]) {
        const result = spawnSync(executable, argsFor({ ...paths, ...overrides }), { encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
    }
    assert.notEqual(spawnSync(executable, []).status, 0);
});

test('workflow configuration exposes editable numeric settings and saves them on the node', () => {
    const view = readFileSync(path.join(root, 'View.js'), 'utf8');
    const start = view.indexOf('    elementParamSpecs(element) {');
    const end = view.indexOf('\n    // Shared parameter dialog', start);
    const context = vm.createContext({});
    vm.runInContext(`class DialogView { ${view.slice(start, end)} }; globalThis.DialogView = DialogView;`, context);
    const fields = new context.DialogView().elementParamSpecs(element);
    assert.equal(fields.length, 5);
    for (const field of fields) {
        assert.equal(field.type, 'number');
        assert.equal(field.default, defaults[field.name]);
        assert.ok(Number.isFinite(field.min));
        assert.ok(Number.isFinite(field.max));
        assert.ok(Number.isFinite(field.step));
    }
    assert.equal(fields[0].step, 16);
    assert.equal(fields[1].step, 2);
    const nodeStart = view.indexOf('    showNodeParamsDialog(tab, node, element) {');
    const nodeEnd = view.indexOf('\n    // Modal alert', nodeStart);
    vm.runInContext(`class NodeDialogView extends DialogView { ${view.slice(nodeStart, nodeEnd)} }; globalThis.NodeDialogView = NodeDialogView;`, context);
    const instance = new context.NodeDialogView();
    const values = { ...defaults, numDisparities: 32, blockSize: 5 };
    let saved;
    instance.controller = { setWorkflowNodeParams: (...args) => { saved = args; } };
    instance.showSchemaDialog = options => {
        assert.equal(options.specs.length, 5);
        options.onApply(values);
    };
    instance.showNodeParamsDialog({ id: 'tab' }, { id: 'node', name: 'Disparity', params: defaults }, element);
    assert.deepEqual(saved, ['tab', 'node', values]);
});
