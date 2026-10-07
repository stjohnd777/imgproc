import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiViewResult } from './ui_view.js';
import { TabModel, isAssignable } from './Data.js';
import { Controller } from './Controller.js';

test('UIViewText accepts text-derived ports and emits preview artifacts', () => {
    const element = JSON.parse(readFileSync(new URL('./elements/ui_view_text.json', import.meta.url)));
    assert.equal(element.name, 'UIViewText');
    assert.equal(element.kind, 'sink');
    assert.deepEqual(element.inputs, [{ name: 'text', type: 'text' }]);
    assert.deepEqual(element.outputs, []);
    assert.equal(element.params.reuse_tab.default, true);
    for (const type of ['text', 'keypoints', 'matches']) assert.equal(isAssignable(type, 'text'), true);
    assert.equal(isAssignable('image', 'text'), false);
    const result = uiViewResult({ nodeId: 'text', name: 'UIViewText', order: 2 },
        { text: '/matches.json' }, 'text');
    assert.equal(result.reuseTab, true);
    assert.deepEqual(result.artifacts, [{ port: 'text', type: 'text', path: '/matches.json' }]);
    assert.throws(() => uiViewResult({ name: 'UIViewText' }, {}, 'text'), /no text/);
});

test('text previews retain exact content, update one tab per sink, and support separate tabs', async t => {
    const previous = globalThis.window;
    t.after(() => { globalThis.window = previous; });
    const requests = [];
    globalThis.window = {
        workflow: { async openArtifact(filename, type) {
            requests.push(type);
            return { kind: 'text', name: filename.slice(1), path: filename, content: `raw <text>\n${filename}\n` };
        } }, alert: assert.fail
    };
    const model = new TabModel();
    const tabId = model.addWorkflowTab();
    const controller = new Controller(model, { render() {} }, null, {});
    const artifact = filename => ({ port: 'text', type: 'text', path: filename });
    await controller.openWorkflowArtifactInTab(tabId, artifact('/one.txt'), `${tabId}:text`);
    const preview = model.getActiveTab();
    assert.equal(preview.type, 'text-artifact');
    assert.equal(preview.content, 'raw <text>\n/one.txt\n');
    await controller.openWorkflowArtifactInTab(tabId, artifact('/two.json'), `${tabId}:text`);
    assert.equal(model.getActiveTab().id, preview.id);
    assert.equal(preview.content, 'raw <text>\n/two.json\n');
    assert.equal(preview.cleanContent, preview.content);
    await controller.openWorkflowArtifactInTab(tabId, artifact('/three.txt'));
    assert.equal(model.findGroupOfTab(tabId).tabs.length, 3);
    assert.deepEqual(requests, ['text', 'text', 'text']);
});
