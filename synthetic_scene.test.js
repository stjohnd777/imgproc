import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseSceneDocument, selectSceneCamera, renameSceneModel } from './scene_document.js';
import { renderSyntheticScene } from './synthetic_scene.js';
import { showSceneDialog } from './scene_dialog.js';
import { executeCli } from './cli_process.js';

const root = import.meta.dirname;
const paramsFile = path.join(root, 'SynC/scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json');
const text = await readFile(paramsFile, 'utf8');

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'synthetic-scene-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('single image source declaration, scene structure, selection, and reference-preserving renames', async () => {
    const element = JSON.parse(await readFile(new URL('./elements/synthetic_scene_source.json', import.meta.url)));
    assert.deepEqual(element.outputs, [{ name: 'image', type: 'image' }]);
    assert.equal(element.kind, 'source');
    assert.equal(element.exec.builtin, 'synthetic_scene_source');
    const scene = parseSceneDocument(text);
    assert.equal(selectSceneCamera(scene), scene.camera_rig.cameras[0].name);
    assert.equal(selectSceneCamera(scene, 'Blackfly_Right'), 'Blackfly_Right');
    assert.throws(() => selectSceneCamera(scene, 'missing'), /not in/);
    scene.trajectory = { type: 'orbit', target: 'cassini' };
    renameSceneModel(scene, 0, 'probe');
    assert.equal(scene.trajectory.target, 'probe');
    scene.trajectory = { type: 'linear', object: 'probe' };
    renameSceneModel(scene, 0, 'target');
    assert.equal(scene.trajectory.object, 'target');
    assert.throws(() => parseSceneDocument('{'), SyntaxError);
    assert.throws(() => parseSceneDocument(' '.repeat(1024 * 1024 + 1)), /1 MB/);
    scene.camera_rig.cameras[1].name = scene.camera_rig.cameras[0].name;
    assert.throws(() => parseSceneDocument(JSON.stringify(scene)), /uniquely/);
});

test('uses edited snapshot, preserves complete rig, selects manifest camera, and isolates repeated renders', async t => {
    const directory = await fixture(t);
    const scene = parseSceneDocument(text);
    scene.environment.sun.direction.azimuth_deg = 123;
    const original = await readFile(paramsFile, 'utf8');
    const options = {
        appDir: root, runDir: directory, blender: 'blender', isAllowed: () => true,
        async render(executable, args, settings) {
            assert.equal(executable, 'blender');
            assert.ok(args.includes(path.join(root, 'SynC/pylib/render_scene.py')));
            assert.equal(settings.timeout, 300000);
            const snapshot = args[args.indexOf('--params') + 1];
            const document = JSON.parse(await readFile(snapshot, 'utf8'));
            assert.equal(document.camera_rig.cameras.length, 2);
            assert.equal(document.camera_rig.baseline_m, 0.12);
            assert.equal(document.environment.sun.direction.azimuth_deg, 123);
            const out = args[args.indexOf('--output-dir') + 1];
            await writeFile(path.join(out, 'right.png'), 'image');
            await writeFile(path.join(out, 'render_manifest.json'), JSON.stringify({
                frames: [{ images: { Blackfly_Left: 'left.png', Blackfly_Right: 'right.png' } }]
            }));
        }
    };
    const params = { params_file: paramsFile, config_json: JSON.stringify(scene), camera_name: 'Blackfly_Right' };
    const first = await renderSyntheticScene(params, options);
    const second = await renderSyntheticScene(params, options);
    assert.equal(first.files.length, 1);
    assert.equal(path.basename(first.files[0]), 'right.png');
    assert.notEqual(first.outputDir, second.outputDir);
    assert.equal(await readFile(paramsFile, 'utf8'), original);
});

test('file loading, trajectory frame ordering, renderer and output errors', async t => {
    const directory = await fixture(t);
    const options = { appDir: root, runDir: directory, blender: 'blender', isAllowed: () => true };
    await assert.rejects(renderSyntheticScene({ params_file: paramsFile }, {
        ...options, isAllowed: () => false
    }), /not authorized/);
    await assert.rejects(renderSyntheticScene({ params_file: paramsFile, camera_name: 'wrong' }, options), /not in/);
    await assert.rejects(renderSyntheticScene({ params_file: paramsFile }, {
        ...options, render: async () => { throw new Error('Blender failed'); }
    }), /Blender failed/);
    async function renderManifest(args, frames) {
        const out = args[args.indexOf('--output-dir') + 1];
        await writeFile(path.join(out, 'render_manifest.json'), JSON.stringify({ frames }));
        return out;
    }
    await assert.rejects(renderSyntheticScene({ params_file: paramsFile }, {
        ...options, render: async (_, args) => renderManifest(args, [])
    }), /no frames/);
    await assert.rejects(renderSyntheticScene({ params_file: paramsFile }, {
        ...options, render: async (_, args) => renderManifest(args, [{ images: { Blackfly_Left: '../outside.png' } }])
    }), /inside/);
    const scene = parseSceneDocument(text);
    scene.trajectory = { type: 'linear', object: 'cassini', frame: 'world',
        start_position_m: [0, 30, 0], end_position_m: [0, 29, 0], max_step_m: 1 };
    const result = await renderSyntheticScene({ params_file: paramsFile, config_json: JSON.stringify(scene) }, {
        ...options, async render(_, args) {
            const out = await renderManifest(args, [
                { images: { Blackfly_Left: 'frame_2.png' } }, { images: { Blackfly_Left: 'frame_1.png' } }
            ]);
            await writeFile(path.join(out, 'frame_1.png'), 'image');
            await writeFile(path.join(out, 'frame_2.png'), 'image');
        }
    });
    assert.deepEqual(result.files.map(file => path.basename(file)), ['frame_2.png', 'frame_1.png']);
});

// Minimal DOM event harness exercises the dialog without adding a test dependency.
class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.value = ''; this.style = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(event, callback) { this.events[event] = callback; }
    async emit(event) { await this.events[event]?.({ preventDefault() {} }); }
    querySelectorAll(tag) {
        return this.children.flatMap(child => child instanceof Element
            ? [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)] : []);
    }
}

test('dialog edits Sun/models, applies advanced rig JSON, saves snapshot, and reports malformed JSON', async t => {
    const previousDocument = globalThis.document, previousWindow = globalThis.window;
    t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
    globalThis.document = { createElement: tag => new Element(tag), createTextNode: text => text };
    globalThis.window = { workflow: { readScene: async () => text } };
    const backdrop = new Element('div');
    let saved;
    const view = { thresholdModal: backdrop, controller: {
        setWorkflowNodeParams(tab, node, params) { saved = params; }
    } };
    const element = JSON.parse(await readFile(new URL('./elements/synthetic_scene_source.json', import.meta.url)));
    await showSceneDialog(view, { id: 'tab' }, { id: 'source', name: 'Scene', params: {} }, element);
    const form = backdrop.children[0];
    const inputs = form.querySelectorAll('input');
    const editor = form.querySelectorAll('textarea')[0];
    inputs[2].value = '210';
    await inputs[2].emit('input');
    assert.equal(JSON.parse(editor.value).environment.sun.direction.azimuth_deg, 210);
    inputs[4].value = 'new-name';
    await inputs[4].emit('input');
    assert.equal(JSON.parse(editor.value).models[0].name, 'new-name');
    const advanced = JSON.parse(editor.value);
    advanced.camera_rig.cameras[1].focal_length_mm = 15;
    editor.value = JSON.stringify(advanced);
    await editor.emit('input');
    assert.equal(inputs[4].disabled, true);
    const apply = form.querySelectorAll('button').find(button => button.textContent === 'Apply JSON to fields');
    await apply.emit('click');
    form.querySelectorAll('select')[0].value = 'Blackfly_Right';
    await form.emit('submit');
    assert.equal(saved.camera_name, 'Blackfly_Right');
    assert.equal(parseSceneDocument(saved.config_json).camera_rig.cameras[1].focal_length_mm, 15);
    assert.equal(parseSceneDocument(saved.config_json).models[0].name, 'new-name');
    assert.equal(backdrop.hidden, true);
    saved = null;
    editor.value = '{';
    await editor.emit('input');
    await form.emit('submit');
    assert.equal(saved, null);
    assert.ok(form.querySelectorAll('p').some(p => p.textContent?.includes('JSON')));
});

test('real Blender static, linear, and orbit renders emit the selected camera images', {
    skip: !existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
}, async t => {
    const directory = await fixture(t);
    const scene = parseSceneDocument(text);
    const logs = [];
    scene.scene.render.resolution_px = [32, 24];
    scene.scene.render.samples = 1;
    const result = await renderSyntheticScene({
        params_file: paramsFile, config_json: JSON.stringify(scene), camera_name: 'Blackfly_Right'
    }, {
        appDir: root, runDir: directory, blender: '/Applications/Blender.app/Contents/MacOS/Blender',
        isAllowed: () => true,
        render: (exe, args, options) => executeCli(exe, args, options, entry => logs.push(entry), 'Synthetic Scene')
    });
    assert.equal(result.files.length, 1);
    assert.ok(logs.some(entry => entry.stream === 'stdout'));
    assert.match(logs.at(-1).text, /exit 0/);
    const png = await readFile(result.files[0]);
    assert.equal(png.readUInt32BE(16), 32);
    assert.equal(png.readUInt32BE(20), 24);
    assert.ok((await stat(path.join(result.outputDir, `${scene.output.prefix}.blend`))).size > 0);
    for (const trajectory of [
        { type: 'linear', object: 'cassini', frame: 'world',
            start_position_m: [0, 30, 0], end_position_m: [0, 29, 0], max_step_m: 1 },
        { type: 'orbit', target: 'cassini', frame: 'world', radius_m: 30,
            sweep_angle_deg: 1, max_step_m: 1 }
    ]) {
        scene.trajectory = trajectory;
        const motion = await renderSyntheticScene({
            params_file: paramsFile, config_json: JSON.stringify(scene), camera_name: 'Blackfly_Right'
        }, {
            appDir: root, runDir: directory, blender: '/Applications/Blender.app/Contents/MacOS/Blender',
            isAllowed: () => true
        });
        assert.equal(motion.files.length, 2);
        const manifest = JSON.parse(await readFile(path.join(motion.outputDir, 'render_manifest.json'), 'utf8'));
        assert.equal(Object.keys(manifest.frames[0].images).length, 2);
        assert.equal(manifest.metadata.scene_params.camera_rig.cameras.length, 2);
        assert.ok(motion.files.every(file => file.includes('Blackfly_Right')));
    }
});
