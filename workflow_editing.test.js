import test from 'node:test';
import assert from 'node:assert/strict';
import { TabModel } from './Data.js';
import { Controller } from './Controller.js';

const source = { id: 'src', name: 'Source', kind: 'source', outputs: [{ name: 'image', type: 'image' }] };
const filter = {
    id: 'flt', name: 'Filter', kind: 'filter',
    inputs: [{ name: 'image', type: 'image' }], outputs: [{ name: 'image', type: 'image' }]
};

function setup() {
    const model = new TabModel();
    let renders = 0;
    const controller = new Controller(model, { render() { renders += 1; }, refreshConsole() {} }, null, {
        specs: { elements: { specs: [{ file: 'src.json', spec: source }, { file: 'flt.json', spec: filter }] } }
    });
    const tabId = model.addWorkflowTab();
    const tab = model.getTab(tabId);
    controller.addWorkflowNode(tabId, 'src.json', 10, 10);
    controller.addWorkflowNode(tabId, 'flt.json', 200, 10);
    controller.addWorkflowNode(tabId, 'flt.json', 400, 10);
    const [a, b, c] = tab.graph.nodes.map(n => n.id);
    controller.connectWorkflowPorts(tabId, { nodeId: a, port: 'image' }, { nodeId: b, port: 'image' });
    controller.connectWorkflowPorts(tabId, { nodeId: b, port: 'image' }, { nodeId: c, port: 'image' });
    return { model, controller, tabId, tab, a, b, c, renders: () => renders };
}

test('adding a node selects it and node/edge selections are exclusive', () => {
    const { model, controller, tabId, tab, c } = setup();
    assert.deepEqual(tab.selectedNodeIds, [c]);
    controller.selectWorkflowEdge(tabId, tab.graph.edges[0].id);
    assert.deepEqual(tab.selectedNodeIds, []);
    model.setWorkflowSelection(tabId, [c, c, 'missing']);
    assert.deepEqual(tab.selectedNodeIds, [c]);
    assert.equal(tab.selectedEdgeId, null);
});

test('moving several nodes is one undo step and undo/redo restore positions and selection', () => {
    const { controller, tabId, tab, a, b } = setup();
    controller.setWorkflowSelection(tabId, [a, b]);
    const before = tab.workflowHistory.undo.length;
    controller.moveWorkflowNodes(tabId, { [a]: { x: 50, y: 60 }, [b]: { x: 240.4, y: 60 } });
    assert.equal(tab.workflowHistory.undo.length, before + 1);
    assert.deepEqual(tab.graph.nodes.slice(0, 2).map(n => [n.x, n.y]), [[50, 60], [240, 60]]);

    controller.setWorkflowSelection(tabId, []);
    assert.ok(controller.undoWorkflow(tabId) !== false);
    assert.deepEqual(tab.graph.nodes.slice(0, 2).map(n => [n.x, n.y]), [[10, 10], [200, 10]]);
    assert.deepEqual(tab.selectedNodeIds, [a, b]);
    controller.redoWorkflow(tabId);
    assert.equal(tab.graph.nodes[0].x, 50);
});

test('an edit that changes nothing adds no history, and a new edit clears redo', () => {
    const { controller, tabId, tab, a } = setup();
    tab.dirty = false;
    const count = tab.workflowHistory.undo.length;
    controller.moveWorkflowNodes(tabId, { [a]: { x: 10, y: 10 } });
    assert.equal(tab.workflowHistory.undo.length, count);
    assert.equal(tab.dirty, false);

    controller.undoWorkflow(tabId);
    assert.equal(tab.workflowHistory.redo.length, 1);
    controller.moveWorkflowNodes(tabId, { [a]: { x: 99, y: 10 } });
    assert.equal(tab.workflowHistory.redo.length, 0);
    assert.equal(tab.dirty, true);
});

test('deleting the selection removes nodes and their connections', () => {
    const { controller, tabId, tab, b } = setup();
    controller.setWorkflowSelection(tabId, [b]);
    controller.deleteWorkflowSelection(tabId);
    assert.equal(tab.graph.nodes.length, 2);
    assert.equal(tab.graph.edges.length, 0);
    assert.deepEqual(tab.selectedNodeIds, []);
    controller.undoWorkflow(tabId);
    assert.equal(tab.graph.nodes.length, 3);
    assert.equal(tab.graph.edges.length, 2);
});

test('delete with only a connection selected removes that connection', () => {
    const { controller, tabId, tab } = setup();
    controller.selectWorkflowEdge(tabId, tab.graph.edges[0].id);
    controller.deleteWorkflowSelection(tabId);
    assert.equal(tab.graph.nodes.length, 3);
    assert.equal(tab.graph.edges.length, 1);
});

test('copy/paste keeps only internal connections, uses new ids, offsets, and selects the paste', () => {
    const { controller, tabId, tab, a, b, c } = setup();
    controller.setWorkflowSelection(tabId, [b, c]);
    assert.equal(controller.copyWorkflowSelection(tabId), true);
    const first = controller.pasteWorkflowClipboard(tabId);
    assert.equal(first.length, 2);
    assert.ok(first.every(id => ![a, b, c].includes(id)));
    assert.deepEqual(tab.selectedNodeIds, first);
    const pasted = tab.graph.nodes.filter(n => first.includes(n.id));
    assert.deepEqual(pasted.map(n => [n.x, n.y]), [[232, 42], [432, 42]]);
    const pastedEdges = tab.graph.edges.filter(e => first.includes(e.to.nodeId));
    assert.equal(pastedEdges.length, 1);
    assert.deepEqual([pastedEdges[0].from.nodeId, pastedEdges[0].to.nodeId], first);

    const second = controller.pasteWorkflowClipboard(tabId);
    assert.equal(tab.graph.nodes.find(n => n.id === second[0]).x, 264);
});

test('cut then paste into another workflow tab', () => {
    const { model, controller, tabId, tab, b, c } = setup();
    controller.setWorkflowSelection(tabId, [b, c]);
    controller.cutWorkflowSelection(tabId);
    assert.equal(tab.graph.nodes.length, 1);
    assert.equal(tab.graph.edges.length, 0);

    const otherId = model.addWorkflowTab();
    const ids = controller.pasteWorkflowClipboard(otherId);
    const other = model.getTab(otherId);
    assert.equal(other.graph.nodes.length, 2);
    assert.equal(other.graph.edges.length, 1);
    assert.deepEqual(other.graph.nodes.map(n => n.x), [200, 400], 'first paste after cut keeps positions');
    assert.deepEqual(other.selectedNodeIds, ids);
    assert.equal(other.dirty, true);
});

test('duplicate pastes the selection without replacing the clipboard', () => {
    const { controller, tabId, tab, a, b } = setup();
    controller.setWorkflowSelection(tabId, [a]);
    controller.copyWorkflowSelection(tabId);
    controller.setWorkflowSelection(tabId, [b]);
    const ids = controller.duplicateWorkflowSelection(tabId);
    assert.equal(ids.length, 1);
    assert.equal(tab.graph.nodes.find(n => n.id === ids[0]).elementId, 'flt');
    assert.equal(controller.workflowClipboard.nodes[0].id, a);
});

test('select all, and copy with nothing selected does nothing', () => {
    const { controller, tabId, tab } = setup();
    controller.setWorkflowSelection(tabId, []);
    assert.equal(controller.copyWorkflowSelection(tabId), false);
    assert.deepEqual(controller.pasteWorkflowClipboard(tabId), []);
    controller.selectAllWorkflowNodes(tabId);
    assert.equal(tab.selectedNodeIds.length, 3);
});
