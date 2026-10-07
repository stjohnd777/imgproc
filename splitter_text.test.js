import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { isAssignable } from './Data.js';
import { uiViewResult } from './ui_view.js';

const element = JSON.parse(await readFile(new URL('./elements/splitter_text.json', import.meta.url), 'utf8'));

test('SplitterText mirrors the image splitter with compatible text ports', async () => {
    const imageSplitter = JSON.parse(await readFile(new URL('./elements/splitter.json', import.meta.url), 'utf8'));
    assert.equal(element.name, 'SplitterText');
    assert.equal(element.kind, imageSplitter.kind);
    assert.equal(element.category, 'utility');
    assert.deepEqual(element.exec, imageSplitter.exec);
    assert.deepEqual(element.params, {});
    assert.deepEqual(element.inputs, [{ name: 'text', type: 'text' }]);
    assert.deepEqual(element.outputs, [{ name: 'a', type: 'text' }, { name: 'b', type: 'text' }]);
    for (const type of ['text', 'keypoints', 'matches']) assert.equal(isAssignable(type, 'text'), true);
    assert.equal(isAssignable('image', 'text'), false);
});

test('frame runner forwards unchanged text artifacts to both branches and rejects missing input', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'splitter-text-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const input = path.join(directory, 'input.txt');
    const content = 'Plain text need not be JSON.\n<unchanged>\n';
    await writeFile(input, content);
    const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
    const context = vm.createContext({
        path, mkdir, stat, performance, uiViewResult,
        isInAllowedFolder: filename => filename.startsWith(directory)
    });
    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const steps = [
        { nodeId: 'source', elementId: 'source', name: 'Source', order: 1, sources: {}, outputPorts: [{ name: 'text', type: 'text' }] },
        { nodeId: 'splitter', elementId: element.id, name: element.name, order: 2,
            sources: { text: { nodeId: 'source', port: 'text' } }, outputPorts: element.outputs },
        ...['a', 'b'].map((port, index) => ({
            nodeId: port, elementId: 'viewer', name: port, order: index + 3,
            sources: { text: { nodeId: 'splitter', port } }, outputPorts: []
        }))
    ];
    const options = {
        steps, elements: new Map([['source', {}], [element.id, element], ['viewer', { exec: { builtin: 'ui_view_text' } }]]),
        sourceFrames: new Map([['source', { repeat: true, files: [input], port: 'text' }]]),
        runDir: directory, frame: 1
    };
    const results = await context.runFrame(options);
    assert.equal(results[1].artifacts.length, 2);
    for (const artifact of results[1].artifacts) {
        assert.equal(artifact.path, input);
        assert.equal(artifact.type, 'text');
    }
    assert.equal(results[2].output, input);
    assert.equal(results[3].output, input);
    assert.equal(await readFile(input, 'utf8'), content);
    steps[1].sources.text = null;
    await assert.rejects(context.runFrame(options), /no input to pass on/);
});
