import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ELEMENT_CATEGORIES, elementCategory } from './view_helpers.js';
import { View } from './View.js';

const directory = new URL('./elements/', import.meta.url);
const items = readdirSync(directory).filter(file => file.endsWith('.json')).map(file => ({
    file, spec: JSON.parse(readFileSync(new URL(file, directory), 'utf8'))
}));
const expected = {
    source: ['camera_source', 'dir_source', 'single_image_source', 'sync_camera_source',
        'physical_camera_source', 'synthetic_scene_source'],
    enhancement: ['gaussian', 'median', 'bilateral', 'clahe', 'stretch'],
    geometry: ['undistort', 'remap', 'stereo_calibrate', 'stereo_rectify'],
    segmentation: ['threshold', 'morphology', 'canny', 'sobel', 'contours'],
    feature: ['orb', 'sift', 'surf', 'fast', 'brisk', 'kaze', 'corners'],
    stereo: ['disparity', 'simple_stereo', 'dense_stereo'],
    ai_ml: ['stereo_pose_estimator'],
    analysis: ['histogram', 'fourier', 'image_diff'],
    simulation: ['add_noise', 'distort'],
    utility: ['convert', 'splitter', 'splitter3', 'splitter4', 'splitter_text', 'process_text', 'hconcat', 'vconcat'],
    sink: ['ui_view', 'ui_view_text', 'image_dir_sink', 'text_dir_sink', 'pointcloud_dir_sink']
};

test('all installed elements have the recommended palette groups with unchanged IDs', () => {
    assert.deepEqual(ELEMENT_CATEGORIES.map(section => section.title), [
        'Sources', 'Image Enhancement', 'Geometry & Calibration', 'Segmentation & Edges',
        'Features', 'Stereo & 3D', 'AI/ML', 'Analysis', 'Simulation', 'Utilities', 'Sinks & Viewers'
    ]);
    for (const [category, ids] of Object.entries(expected)) {
        assert.deepEqual(items.filter(item => elementCategory(item.spec) === category)
            .map(item => item.spec.id).sort(), [...ids].sort(), category);
    }
    assert.equal(items.length, Object.values(expected).flat().length);
    assert.equal(new Set(items.map(item => item.spec.id)).size, items.length);
});

test('legacy categories, role fallbacks, and custom categories remain supported', () => {
    assert.equal(elementCategory({ category: 'filter', kind: 'transform' }), 'enhancement');
    assert.equal(elementCategory({ category: 'flow', kind: 'transform' }), 'utility');
    assert.equal(elementCategory({ kind: 'transform' }), 'utility');
    assert.equal(elementCategory({ kind: 'source' }), 'source');
    assert.equal(elementCategory({ kind: 'sink' }), 'sink');
    assert.equal(elementCategory({ category: 'custom', kind: 'transform' }), 'custom');
});

test('palette renders every element once in category order and retains drag identifiers', t => {
    class Element {
        children = [];
        listeners = {};
        attributes = {};
        appendChild(child) { this.children.push(child); return child; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, listener) { this.listeners[name] = listener; }
    }
    const previous = globalThis.document;
    globalThis.document = {
        createElement: () => new Element(),
        createElementNS: () => new Element()
    };
    t.after(() => {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    });
    const sideBar = new Element();
    const view = {
        sideBar, specs: { elements: { specs: items } }, controller: {},
        collapsedPaletteCategories: new Set(),
        buildSideBarHeader: () => sideBar.appendChild(new Element())
    };
    View.prototype.renderElementPalette.call(view);
    const headings = sideBar.children.filter(child => child.className === 'palette-heading');
    assert.deepEqual(headings.map(child => child.children.at(-1).textContent),
        ELEMENT_CATEGORIES.map(section => `${section.title} (${expected[section.category].length})`));
    assert.ok(headings.every(child => child.children.length === 3), 'each heading has twisty, category icon and label');
    const lists = sideBar.children.filter(child => child.className === 'palette-list');
    const dragged = [];
    for (const [index, list] of lists.entries()) {
        const sectionItems = items.filter(item =>
            elementCategory(item.spec) === ELEMENT_CATEGORIES[index].category);
        assert.deepEqual(list.children.map(child => child.children[1].textContent),
            sectionItems.map(item => item.spec.name));
        for (const child of list.children) {
            assert.equal(child.draggable, true);
            child.listeners.dragstart({ dataTransfer: {
                setData(type, value) {
                    assert.equal(type, 'application/x-workflow-element');
                    dragged.push(value);
                }
            } });
        }
    }
    assert.deepEqual(dragged.sort(), items.map(item => item.file).sort());
    for (const [index, heading] of headings.entries()) {
        assert.equal(heading.type, 'button');
        assert.equal(heading.attributes['aria-expanded'], 'true');
        assert.equal(heading.attributes['aria-controls'], lists[index].id);
        assert.equal(lists[index].hidden, false);
        assert.equal(heading.children[0].textContent, '▾');
    }
    headings[1].listeners.click();
    assert.equal(lists[1].hidden, true);
    assert.equal(headings[1].attributes['aria-expanded'], 'false');
    assert.equal(headings[1].children[0].textContent, '▸');
    assert.equal(lists[0].hidden, false);
    sideBar.children = [];
    View.prototype.renderElementPalette.call(view);
    const refreshedHeadings = sideBar.children.filter(child => child.className === 'palette-heading');
    const refreshedLists = sideBar.children.filter(child => child.className === 'palette-list');
    assert.equal(refreshedLists[1].hidden, true);
    assert.equal(refreshedHeadings[1].attributes['aria-expanded'], 'false');
    refreshedHeadings[1].listeners.click();
    assert.equal(refreshedLists[1].hidden, false);
    assert.equal(view.collapsedPaletteCategories.size, 0);
});
