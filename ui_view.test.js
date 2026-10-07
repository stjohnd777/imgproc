import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TabModel } from './Data.js';
import { Controller } from './Controller.js';
import { View } from './View.js';
import { uiViewResult } from './ui_view.js';

function setup(t, workflow) {
    const previous = globalThis.window;
    const alerts = [];
    globalThis.window = { workflow, alert: message => alerts.push(message) };
    t.after(() => { globalThis.window = previous; });
    const model = new TabModel();
    const tabId = model.addWorkflowTab();
    const view = {
        render() {}, highlightExecutingNode() {}, showWorkflowFinishedAlert() {}
    };
    const controller = new Controller(model, view, null, {});
    return { model, tabId, controller, alerts };
}

function openedImage(filename) {
    return { kind: 'image', path: filename, name: filename.split('/').at(-1), url: `file://${filename}` };
}

test('UIView declares an image-only sink with no configuration or native executable', () => {
    const element = JSON.parse(readFileSync(new URL('./elements/ui_view.json', import.meta.url)));
    assert.equal(element.name, 'UIView');
    assert.equal(element.kind, 'sink');
    assert.equal(element.category, 'sink');
    assert.deepEqual(element.inputs, [{ name: 'image', type: 'image' }]);
    assert.deepEqual(element.outputs, []);
    assert.equal(element.exec.builtin, 'ui_view');
    assert.equal(element.exec.cli, undefined);
    assert.equal(View.prototype.elementParamSpecs.call({}, element)[0].default, true);
});

test('UIView emits an artifact for viewing without creating another image', () => {
    const step = { nodeId: 'viewer', name: 'UIView', order: 2 };
    assert.deepEqual(uiViewResult(step, { image: '/frames/input.png' }), {
        ...step, ms: 0, output: '/frames/input.png', uiView: true, reuseTab: true,
        artifacts: [{ port: 'image', type: 'image', path: '/frames/input.png' }]
    });
    assert.throws(() => uiViewResult(step, {}), /no image to view/);
});

test('opens images in the workflow group, reuses existing tabs, and preserves manual artifact opening', async t => {
    const { model, tabId, controller } = setup(t, { openArtifact: async filename => openedImage(filename) });
    const group = model.findGroupOfTab(tabId);
    const other = model.createGroup(1, 1);
    model.activeGroupId = other.id;
    const artifact = { port: 'image', type: 'image', path: '/frames/a.png' };
    await controller.openWorkflowArtifactInTab(tabId, artifact);
    assert.equal(model.getActiveTab().path, artifact.path);
    assert.equal(model.getActiveTab().src, 'file:///frames/a.png');
    assert.equal(model.activeGroupId, group.id);
    assert.equal(other.tabs.length, 0);
    assert.equal(group.tabs.length, 2);
    model.selectTab(tabId);
    model.getTab(tabId).latestArtifacts = { viewer: [artifact] };
    await controller.openWorkflowArtifact(tabId, 'viewer', 'image');
    assert.equal(group.tabs.length, 2);
    assert.equal(model.getActiveTab().path, artifact.path);
});

test('multiple rapid frames open all UIView images in order and leave other artifacts closed', async t => {
    const listeners = new Map(), opened = [];
    let removed = 0;
    const workflow = {
        on(event, listener) {
            listeners.set(event, listener);
            return () => { listeners.delete(event); removed++; };
        },
        async openArtifact(filename) {
            await new Promise(resolve => setTimeout(resolve, 5));
            opened.push(filename);
            return openedImage(filename);
        },
        async run() {
            for (let frame = 1; frame <= 3; frame++) {
                listeners.get('frame')({
                    frame, frames: 3, ms: 1, late: false,
                    steps: [
                        uiViewResult({ nodeId: 'viewer', name: 'UIView', order: 2, params: { reuse_tab: false } }, { image: `/frames/${frame}.png` }),
                        { nodeId: 'filter', name: 'Filter', order: 1, ms: 1,
                            artifacts: [{ port: 'image', type: 'image', path: `/hidden/${frame}.png` }] }
                    ]
                });
            }
            return { frames: 3, late: 0, stopped: false, runDir: '/runs/test' };
        }
    };
    const { model, tabId, controller } = setup(t, workflow);
    await controller.runWorkflow(tabId);
    assert.deepEqual(opened, ['/frames/1.png', '/frames/2.png', '/frames/3.png']);
    assert.equal(model.findGroupOfTab(tabId).tabs.length, 4);
    assert.equal(model.getActiveTab().path, '/frames/3.png');
    assert.equal(model.getTab(tabId).running, false);
    assert.equal(removed, 3);
    await new Promise(resolve => setTimeout(resolve, 60));
});

test('reusable sink preview updates paths, clears processed results, and recreates closed tabs', async t => {
    const { model, tabId, controller } = setup(t, { openArtifact: async filename => openedImage(filename) });
    const key = `${tabId}:sink`;
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/one.png' }, key);
    const preview = model.getActiveTab();
    preview.resultSrc = 'processed.png';
    preview.fitImage = true;
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/two.png' }, key);
    assert.equal(model.getActiveTab().id, preview.id);
    assert.equal(preview.path, '/two.png');
    assert.equal(preview.resultSrc, null);
    assert.equal(preview.fitImage, true);
    assert.equal(model.findGroupOfTab(tabId).tabs.length, 2);
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/two.png' }, `${tabId}:other`);
    assert.equal(model.findGroupOfTab(tabId).tabs.length, 3);
    model.closeTab(preview.id);
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/three.png' }, key);
    assert.notEqual(model.getActiveTab().id, preview.id);
});

test('view failures are reported, subsequent images still open, and closed workflows are ignored', async t => {
    const { model, tabId, controller, alerts } = setup(t, {
        async openArtifact(filename) {
            if (filename === '/missing.png') throw new Error('Image is not authorized');
            return openedImage(filename);
        }
    });

    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/missing.png' });
    assert.deepEqual(alerts, ['Could not open image: Image is not authorized']);
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/valid.png' });
    assert.equal(model.getActiveTab().path, '/valid.png');
    model.closeTab(tabId);
    await controller.openWorkflowArtifactInTab(tabId, { port: 'image', path: '/ignored.png' });
    assert.equal(model.getActiveTab().path, '/valid.png');
});

for (const progressArrives of [false, true]) {
        test(`single-frame source → UIView survives completion/progress ordering (progress=${progressArrives})`, async t => {
            const listeners = new Map();
            const opened = [];
            const frame = {
                frame: 1, frames: 1, ms: 0, late: false,
                steps: [
                    { nodeId: 'scene', name: 'Synthetic Scene', order: 1, ms: 0,
                        artifacts: [{ port: 'image', type: 'image', path: '/sources/cassini.png' }] },
                    uiViewResult({ nodeId: 'viewer', name: 'UIView', order: 2 },
                        { image: '/sources/cassini.png' })
                ]
            };
            const { model, tabId, controller } = setup(t, {
                on(event, callback) {
                    listeners.set(event, callback);
                    return () => listeners.delete(event);
                },
                async run() {
                    if (progressArrives) listeners.get('frame')(frame);
                    return { frames: 1, late: 0, stopped: false, runDir: '/runs/test', lastFrame: frame };
                },
                async openArtifact(filename) {
                    opened.push(filename);
                    return openedImage(filename);
                }
            });
            await controller.runWorkflow(tabId);
            assert.deepEqual(opened, ['/sources/cassini.png']);
            assert.equal(model.getActiveTab().path, '/sources/cassini.png');
            assert.equal(model.getTab(tabId).latestArtifacts.scene[0].path, '/sources/cassini.png');
            assert.equal(model.getTab(tabId).latestArtifacts.viewer[0].path, '/sources/cassini.png');
            assert.equal(model.getTab(tabId).running, false);
            await new Promise(resolve => setTimeout(resolve, 60));
        });
}
