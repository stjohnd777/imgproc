import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { uiViewResult } from './ui_view.js';

const load = async file => JSON.parse(await readFile(new URL(`./elements/${file}`, import.meta.url), 'utf8'));
const base = await load('splitter.json');

for (const [file, ports] of [['splitter3.json', ['a', 'b', 'c']], ['splitter4.json', ['a', 'b', 'c', 'd']]]) {
    const element = await load(file);

    test(`${element.name} matches the two-way splitter with ${ports.length} image outputs`, () => {
        for (const key of ['kind', 'category', 'icon', 'inputs', 'params', 'telemetry', 'exec']) {
            assert.deepEqual(element[key], base[key], key);
        }
        assert.deepEqual(element.outputs, ports.map(name => ({ name, type: 'image' })));
    });

    test(`${element.name} forwards the unchanged image to every branch`, async t => {
        const directory = await mkdtemp(path.join(os.tmpdir(), `${element.id}-test-`));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const input = path.join(directory, 'input.png');
        await writeFile(input, 'not decoded by passthrough');
        const main = await readFile(new URL('./main.js', import.meta.url), 'utf8');
        const context = vm.createContext({
            path, mkdir, stat, performance, uiViewResult,
            isInAllowedFolder: filename => filename.startsWith(directory)
        });
        vm.runInContext(main.match(/^const IMAGE_EXTENSIONS = .*$/m)[0], context);
        vm.runInContext(main.slice(main.indexOf('const PORT_FILE_TYPES'), main.indexOf('// Works out execution order')), context);
        vm.runInContext(main.slice(main.indexOf('async function runFrame('), main.indexOf('// One run at a time')), context);
        const steps = [
            { nodeId: 'source', elementId: 'source', name: 'Source', order: 1, sources: {}, outputPorts: [{ name: 'image', type: 'image' }] },
            { nodeId: 'split', elementId: element.id, name: element.name, order: 2,
                sources: { image: { nodeId: 'source', port: 'image' } }, outputPorts: element.outputs },
            ...ports.map((port, index) => ({
                nodeId: port, elementId: 'viewer', name: port, order: index + 3,
                sources: { image: { nodeId: 'split', port } }, outputPorts: []
            }))
        ];
        const results = await context.runFrame({
            steps,
            elements: new Map([['source', {}], [element.id, element], ['viewer', { exec: { builtin: 'ui_view' } }]]),
            sourceFrames: new Map([['source', { repeat: true, files: [input], port: 'image' }]]),
            runDir: directory, frame: 1
        });
        assert.deepEqual(results[1].artifacts.map(artifact => [artifact.port, artifact.path]),
            ports.map(port => [port, input]));
        for (const index of ports.keys()) assert.equal(results[index + 2].output, input);
    });
}
