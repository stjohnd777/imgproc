import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { processJsonText, processTextFile } from './process_text.js';
import { View } from './View.js';
import { isAssignable } from './Data.js';
import { nodeParameterSummary } from './view_helpers.js';
import { uiViewResult } from './ui_view.js';

const element = JSON.parse(await readFile(new URL('./elements/process_text.json', import.meta.url), 'utf8'));

async function fixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'process-text-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('Process Text uses native workflow roles and compatible text ports', () => {
    assert.equal(element.kind, 'transform');
    assert.equal(element.category, 'utility');
    assert.deepEqual(element.inputs, [{ name: 'text', type: 'text' }]);
    assert.deepEqual(element.outputs, [{ name: 'text', type: 'text' }]);
    assert.deepEqual(element.exec, { builtin: 'process_text' });
    for (const type of ['text', 'keypoints', 'matches']) assert.equal(isAssignable(type, 'text'), true);
    assert.equal(isAssignable('image', 'text'), false);
    assert.equal(View.prototype.elementParamSpecs(element)[0].type, 'code');
    assert.equal(nodeParameterSummary({ elementId: element.id }), 'JSON -> process(objIn) -> JSON');
});

test('default function produces exact means and bounding boxes for Corners JSON and arrays', async () => {
    const keypoints = [{ u: 10, v: 20 }, { u: 30, v: 60 }, { u: 20, v: 40 }];
    const expected = {
        count: 3, mean: { u: 20, v: 40 },
        boundingBox: { minU: 10, minV: 20, maxU: 30, maxV: 60, width: 20, height: 40 }
    };
    for (const input of [{ keypoints, count: 3 }, keypoints]) {
        assert.deepEqual(JSON.parse(await processJsonText(JSON.stringify(input), element.params.code.default)), expected);
    }
    assert.deepEqual(JSON.parse(await processJsonText('{"keypoints":[]}', element.params.code.default)),
        { count: 0, mean: null, boundingBox: null });
    await assert.rejects(processJsonText('{"keypoints":[{"u":null,"v":1}]}', element.params.code.default), /finite numeric/);
});

test('supports JSON values, mutation and fresh state for every invocation', async () => {
    for (const input of ['null', 'false', '42', '"hello"', '[1,2]', '{"a":1}']) {
        assert.deepEqual(JSON.parse(await processJsonText(input, 'function process(objIn) { return objIn; }')), JSON.parse(input));
    }
    const code = 'let count = 0; function process(objIn) { objIn.count = ++count; return objIn; }';
    for (let i = 0; i < 2; i++) assert.deepEqual(JSON.parse(await processJsonText('{}', code)), { count: 1 });
});

test('reports invalid JSON, code, missing function, thrown errors and non-JSON results', async () => {
    await assert.rejects(processJsonText('{', 'function process(x) { return x; }'), SyntaxError);
    await assert.rejects(processJsonText('{}', ''), /Provide a JavaScript/);
    for (const [code, message] of [
        ['function process( {', /Unexpected|Invalid/],
        ['function other(x) { return x; }', /Define function process/],
        ['function process(x) { throw new Error("bad points"); }', /bad points/],
        ['function process(x) {}', /JSON values/],
        ['function process(x) { return { x: undefined }; }', /JSON values/],
        ['function process(x) { return NaN; }', /JSON values/],
        ['function process(x) { return { x: Infinity }; }', /JSON values/],
        ['function process(x) { return 1n; }', /JSON values/],
        ['function process(x) { x.self = x; return x; }', /circular/],
        ['function process(x) { return new Date(); }', /plain JSON/],
        ['async function process(x) { return x; }', /synchronous/],
        ['function process(x) { return fetch("https://example.com"); }', /fetch is not defined/],
        ['function process(x) { return require("node:fs"); }', /require is not defined/]
    ]) await assert.rejects(processJsonText('{}', code), message);
    assert.deepEqual(JSON.parse(await processJsonText('{}',
        'function process(x) { return { require: typeof require, fetch: typeof fetch, timers: typeof setTimeout }; }')),
    { require: 'undefined', fetch: 'undefined', timers: 'undefined' });
});

test('terminates infinite loops without blocking the caller and rejects oversize input/output', async () => {
    let ticked = false;
    const pending = processJsonText('{}', 'function process(x) { while (true) {} }');
    await new Promise(resolve => setTimeout(() => { ticked = true; resolve(); }, 10));
    assert.equal(ticked, true);
    await assert.rejects(pending, /1-second|timed out/);
    await assert.rejects(processJsonText(' '.repeat(5 * 1024 * 1024 + 1), element.params.code.default), /5 MB/);
    await assert.rejects(processJsonText('{}', ' '.repeat(100 * 1024 + 1)), /100 KB/);
    await assert.rejects(processJsonText('{}', 'function process(x) { return "x".repeat(5 * 1024 * 1024); }'), /5 MB/);
});

test('writes per-frame JSON artifacts and surfaces errors in logs without writing success output', async t => {
    const directory = await fixture(t);
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'output.json');
    await writeFile(input, '{"keypoints":[{"u":2,"v":4}]}');
    const entries = [];
    await processTextFile({ input, output, code: element.params.code.default, log: entry => entries.push(entry) });
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).mean, { u: 2, v: 4 });
    assert.match(entries.at(-1).text, /Completed/);
    const failedOutput = path.join(directory, 'failed.json');
    await assert.rejects(processTextFile({
        input, output: failedOutput, code: 'function process(x) { throw new Error("oops"); }',
        label: 'My processor', log: entry => entries.push(entry)
    }), /My processor: oops/);
    assert.equal(entries.at(-1).stream, 'error');
    await assert.rejects(readFile(failedOutput), { code: 'ENOENT' });
});

test('real frame runner connects producer -> Process Text -> Process Text -> UIViewText', async t => {
    const directory = await fixture(t);
    const input = path.join(directory, 'corners.json');
    await writeFile(input, '{"keypoints":[{"u":2,"v":4},{"u":6,"v":8}]}');
    const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
    const context = vm.createContext({
        path, mkdir, performance, processTextFile, uiViewResult,
        isInAllowedFolder: filename => filename.startsWith(directory),
        stat: (await import('node:fs/promises')).stat
    });

    vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
    vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
    const step = (nodeId, elementId, order, sources, outputPorts, params = {}) =>
        ({ nodeId, name: nodeId, elementId, order, sources, outputPorts, params });
    const steps = [
        step('corners', 'source', 1, {}, [{ name: 'keypoints', type: 'keypoints' }]),
        step('statistics', element.id, 2, { text: { nodeId: 'corners', port: 'keypoints' } }, element.outputs, { code: element.params.code.default }),
        step('extract', element.id, 3, { text: { nodeId: 'statistics', port: 'text' } }, element.outputs, { code: 'function process(x) { return x.mean; }' }),
        step('viewer', 'ui_view_text', 4, { text: { nodeId: 'extract', port: 'text' } }, [])
    ];
    const elements = new Map([
        ['source', {}], [element.id, element], ['ui_view_text', { exec: { builtin: 'ui_view_text' } }]
    ]);
    for (const frame of [1, 2]) {
        const results = await context.runFrame({
            steps, elements, sourceFrames: new Map([['corners', { repeat: true, files: [input], port: 'keypoints' }]]),
            runDir: directory, frame
        });
        assert.equal(results.length, 4);
        const artifact = results[2].artifacts[0];
        assert.equal(artifact.type, 'text');
        assert.equal(path.extname(artifact.path), '.json');
        assert.deepEqual(JSON.parse(await readFile(artifact.path, 'utf8')), { u: 4, v: 6 });
        assert.equal(results[3].output, artifact.path);
    }
});

test('workflow loading and saving retain code and rebuild typed text ports', async () => {
    const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
    const context = vm.createContext({
        path, APP_DIR: '/', expandHome: value => value,
        isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value),
        loadElements: async () => new Map([[element.id, element]])
    });
    vm.runInContext(main.slice(main.indexOf('function topologicalOrder('), main.indexOf('// Where each step')), context);
    vm.runInContext(main.slice(main.indexOf('const WORKFLOW_PORT_TYPES'), main.indexOf('async function workflowDocumentForSave')), context);
    const code = 'function process(objIn) {\n  return { mean: objIn.mean };\n}';
    const graph = { nodes: [{ id: 'processor', elementId: element.id, params: { code }, x: 0, y: 0 }], edges: [] };
    const { graph: restored } = await context.normalizeWorkflowGraph(graph);
    assert.equal(restored.nodes[0].params.code, code);
    assert.equal(restored.nodes[0].kind, 'transform');
    assert.equal(restored.nodes[0].outputs[0].type, 'text');
    graph.nodes[0].params.code = 42;
    await assert.rejects(context.normalizeWorkflowGraph(graph), /invalid value for "code"/);
});

test('code dialog uses a multiline editor and saves exact source text', t => {
    class Element {
        children = [];
        listeners = {};
        value = '';
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); }
        setAttribute() {}
        addEventListener(name, callback) { this.listeners[name] = callback; }
        setCustomValidity() {}
    }
    const previous = globalThis.document;
    globalThis.document = { createElement: tag => Object.assign(new Element(), { tag }) };
    t.after(() => { globalThis.document = previous; });
    const backdrop = new Element();
    let saved;
    View.prototype.showSchemaDialog.call({ thresholdModal: backdrop }, {
        title: 'Process Text', specs: View.prototype.elementParamSpecs(element), wide: true,
        onApply: values => { saved = values; }
    });
    const form = backdrop.children[0];
    const textarea = form.children.flatMap(child => child.children).find(child => child.tag === 'textarea');
    assert.equal(textarea.value, element.params.code.default);
    assert.equal(textarea.spellcheck, false);
    textarea.value = 'function process(objIn) {\n  return objIn;\n}';
    form.listeners.submit({ preventDefault() {} });
    assert.equal(saved.code, textarea.value);
    assert.equal(backdrop.hidden, true);
});
