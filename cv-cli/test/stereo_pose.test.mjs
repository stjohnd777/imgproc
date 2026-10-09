import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { renderArgs } from '../../workflow_args.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const spec = JSON.parse(readFileSync(path.join(root, 'elements/stereo_pose_estimator.json')));
const executable = path.join(root, 'cv-cli', spec.exec.cli);

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'stereo-pose-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const inputs = { left: path.join(dir, 'left.pgm'), right: path.join(dir, 'right.pgm') };
    const params = { modelFile: path.join(dir, 'model.onnx'), metadataFile: path.join(dir, 'metadata.json') };
    const outputs = { pose: path.join(dir, 'pose.json') };
    for (const file of Object.values(inputs)) writeFileSync(file, 'P2\n1 1\n255\n0\n');
    // Readable placeholders suffice: the stub does not parse a network or metadata.
    writeFileSync(params.modelFile, 'not a trained network');
    writeFileSync(params.metadataFile, '{}');
    const args = renderArgs(spec.exec.args, { inputs, outputs, params });
    return { dir, inputs, outputs, params, args };
}

test('help succeeds but missing/extra arguments fail explicitly', () => {
    const help = spawnSync(executable, ['--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /ONNX Runtime inference is not implemented/);
    for (const args of [[], ['left'], ['a', 'b', 'c', 'd', 'e', 'extra']]) {
        const result = spawnSync(executable, args, { encoding: 'utf8' });
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Usage:/);
    }
});

test('required files and nonempty output path are checked', t => {
    const f = fixture(t);
    for (let index = 0; index < 4; ++index) {
        for (const replacement of ['', path.join(f.dir, 'missing'), f.dir]) {
            const args = [...f.args];
            args[index] = replacement;
            const result = spawnSync(executable, args, { encoding: 'utf8' });
            assert.equal(result.status, 2, result.stderr);
            assert.match(result.stderr, /missing or unreadable/);
        }
    }
    const result = spawnSync(executable, [...f.args.slice(0, 4), ''], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /output path must not be empty/);
});

test('stub returns failure without creating or overwriting a pose', t => {
    const f = fixture(t);
    assert.deepEqual(f.args, [f.inputs.left, f.inputs.right, f.params.modelFile, f.params.metadataFile, f.outputs.pose]);
    const run = () => spawnSync(executable, f.args, { encoding: 'utf8' });
    const result = run();
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /ONNX Runtime inference is not implemented/);
    assert.equal(existsSync(f.outputs.pose), false);
    writeFileSync(f.outputs.pose, 'existing result');
    assert.equal(run().status, 3);
    assert.equal(readFileSync(f.outputs.pose, 'utf8'), 'existing result');
});

test('workflow authorizes model files, maps stereo inputs, and propagates stub failure', async t => {
    const f = fixture(t);
    const main = readFileSync(path.join(root, 'main.js'), 'utf8');
    let executions = 0;
    let authorized = true;
    const checked = [];
    let invokedArgs;
    const context = vm.createContext({
        path, mkdir, performance, renderArgs, TOOL_TIMEOUT_MS: 30000,
        isInAllowedFolder: file => { checked.push(file); return authorized; },
        resolveCli: name => path.join(root, 'cv-cli', name),
        executeCli: async (exe, args) => {
            executions++;
            invokedArgs = args;
            const result = spawnSync(exe, args, { encoding: 'utf8' });
            if (result.status !== 0) throw new Error(result.stderr);
        }
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const steps = [
        ...['left', 'right'].map((name, i) => ({
            nodeId: name, elementId: 'source', name, order: i + 1, sources: {},
            outputPorts: [{ name: 'image', type: 'image' }]
        })),
        {
            nodeId: 'pose', elementId: spec.id, name: spec.name, order: 3, params: { ...f.params },
            sources: {
                left: { nodeId: 'left', port: 'image' },
                right: { nodeId: 'right', port: 'image' }
            },
            outputPorts: spec.outputs
        }
    ];
    const run = () => context.runFrame({
        steps, elements: new Map([['source', {}], [spec.id, spec]]),
        sourceFrames: new Map(['left', 'right'].map(name => [name, { repeat: true, files: [f.inputs[name]], port: 'image' }])),
        runDir: f.dir, frame: 1
    });
    for (const name of ['modelFile', 'metadataFile']) {
        steps[2].params[name] = '';
        await assert.rejects(run(), new RegExp(`authorized ${name}`));
        steps[2].params[name] = f.params[name];
    }
    authorized = false;
    await assert.rejects(run(), /authorized modelFile/);
    assert.equal(executions, 0);
    authorized = true;
    checked.length = 0;
    await assert.rejects(run(), /ONNX Runtime inference is not implemented/);
    assert.equal(executions, 1);
    assert.deepEqual(checked, [f.params.modelFile, f.params.metadataFile]);
    assert.deepEqual(Array.from(invokedArgs.slice(0, 4)), f.args.slice(0, 4));
    assert.match(invokedArgs[4], /pose\.json$/);
    assert.equal(existsSync(invokedArgs[4]), false);
});
