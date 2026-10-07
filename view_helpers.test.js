import test from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, nodeParameterSummary } from './view_helpers.js';

test('fit contains full image/graph without upscaling', () => {
    assert.equal(fitScale(2000, 1000, 500, 500), 0.25);
    assert.equal(fitScale(100, 200, 500, 500), 1);
    assert.equal(fitScale(1000, 2000, 500, 500), 0.25);
    assert.equal(fitScale(0, 0, 500, 500), 1);
});
test('summaries expose scene camera/sun and common parameters', () => {
    assert.match(nodeParameterSummary({ elementId: 'add_noise', params: { sigma: 5, seed: 0 } }), /sigma: 5.*seed: 0/);
    assert.equal(nodeParameterSummary({ elementId: 'ui_view' }), 'Reuse preview tab');
    assert.equal(nodeParameterSummary({ elementId: 'ui_view', params: { reuse_tab: false } }), 'Separate image tabs');
    const summary = nodeParameterSummary({ elementId: 'synthetic_scene_source', params: {
        params_file: '/scene/params.json', camera_name: 'Right',
        config_json: JSON.stringify({ environment: { sun: { direction: {
            representation: 'azimuth_elevation', azimuth_deg: 180, elevation_deg: 30
        } } } })
    } });
    assert.match(summary, /params.json.*Camera: Right.*Sun: 180/);
    assert.equal(nodeParameterSummary({ elementId: 'synthetic_scene_source', params: { config_json: '{' } }), 'Invalid scene JSON');
});
