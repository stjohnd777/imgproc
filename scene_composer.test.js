import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Matrix4, Vector3 } from 'three';
import {
    newSceneDocument, poseMatrix, matrixRows, poseFromRows, cameraFromProfile,
    cameraProjection, uniqueSceneName, validateComposerDocument, cameraPoseLookingAt
} from './scene_composer_document.js';
import { configuredFolder, createSceneStorage } from './scene_composer_storage.js';
import { renderSyntheticScene } from './synthetic_scene.js';
import { TabModel } from './Data.js';

const root = import.meta.dirname;
const profile = JSON.parse(await readFile(path.join(root, 'camera_spec/bfly_pge_13s2m_cs.json'), 'utf8'));
function document() {
    const doc = newSceneDocument();
    doc.models.push({
        name: 'cassini', file: 'Cassini-Huygens (A).glb',
        pose: { frame: 'world', translation_m: [0, 30, 0], rotation_euler_rad: [0.2, -0.3, 0.4], rotation_order: 'XYZ' }
    });
    doc.camera_rig.cameras.push(cameraFromProfile(profile, 'Camera'));
    return doc;
}
async function fixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'scene-composer-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const modelsDir = path.join(directory, 'models'), scenesDir = path.join(directory, 'scenes');
    await mkdir(modelsDir);
    await writeFile(path.join(modelsDir, 'Cassini-Huygens (A).glb'), 'test model');
    return { directory, modelsDir, scenesDir, storage: createSceneStorage({ modelsDir, scenesDir }) };
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

test('default scene is schema-v1 static and camera profiles use physical optics', () => {
    const doc = document();
    assert.equal(doc.trajectory, undefined);
    assert.equal(validateComposerDocument(doc), doc);
    assert.throws(() => validateComposerDocument(newSceneDocument()), /uniquely named/);
    assert.doesNotThrow(() => validateComposerDocument(newSceneDocument(), false));
    const camera = doc.camera_rig.cameras[0];
    assert.equal(camera.focal_length_mm, 12);
    assert.equal(camera.sensor_width_mm, 4.83);
    assert.throws(() => cameraFromProfile({}, 'Unknown'), /profile needs/);
    const forward = new Vector3(0, 0, -1).transformDirection(poseMatrix(camera.pose));
    near(forward.x, 0, 'camera X'); near(forward.y, 1, 'camera forward +Y'); near(forward.z, 0, 'camera Z');
    const up = new Vector3(0, 1, 0).transformDirection(poseMatrix(camera.pose));
    near(up.z, 1, 'camera up +Z');
    const projection = cameraProjection(camera, [1288, 964]);
    near(projection.aspect, 1288 / 964, 'render aspect');
    near(projection.fov, 2 * Math.atan(4.83 * 964 / 1288 / 24) * 180 / Math.PI, 'vertical FOV');
    near(cameraProjection({ ...camera, sensor_fit: 'VERTICAL' }, [1288, 964]).fov,
        2 * Math.atan(3.615 / 24) * 180 / Math.PI, 'vertical fit');
    assert.equal(uniqueSceneName(doc, 'Camera'), 'Camera 2');
});

test('T matrix matches Blender Euler axis application for every supported order', () => {
    const rotation = [0.23, -0.71, 1.14], translation = [3, -7, 12];
    const rotations = {
        X: new Matrix4().makeRotationX(rotation[0]),
        Y: new Matrix4().makeRotationY(rotation[1]),
        Z: new Matrix4().makeRotationZ(rotation[2])
    };
    for (const order of ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']) {
        const expected = new Matrix4();
        for (const axis of order) expected.premultiply(rotations[axis]);
        expected.setPosition(...translation);
        const actual = poseMatrix({ frame: 'world', translation_m: translation, rotation_euler_rad: rotation, rotation_order: order });
        expected.elements.forEach((value, i) => near(actual.elements[i], value, order));
        const recovered = poseMatrix(poseFromRows(matrixRows(actual), order));
        actual.elements.forEach((value, i) => near(recovered.elements[i], value, `round trip ${order}`));
    }
});

test('aiming points camera -Z exactly at target, preserves position and projects target to image center', () => {
    for (const order of ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']) {
        for (const target of [[0, 30, 0], [7, -8, 15], [3, -7, 30], [3, -7, -30]]) {
            const pose = { frame: 'world', translation_m: [3, -7, 12], rotation_euler_rad: [0.4, 0.5, -0.2], rotation_order: order };
            const aimed = cameraPoseLookingAt(pose, target);
            assert.deepEqual(aimed.translation_m, pose.translation_m);
            assert.equal(aimed.rotation_order, order);
            assert.deepEqual(pose.rotation_euler_rad, [0.4, 0.5, -0.2], 'does not mutate original');
            const matrix = poseMatrix(aimed);
            const direction = new Vector3(...target).sub(new Vector3(...pose.translation_m)).normalize();
            const forward = new Vector3(0, 0, -1).transformDirection(matrix);
            near(forward.dot(direction), 1, `forward ${order}`);
            const local = new Vector3(...target).applyMatrix4(matrix.clone().invert());
            near(local.x, 0, 'image center X'); near(local.y, 0, 'image center Y');
            assert.ok(local.z < 0, 'target is in front of camera');
            const up = new Vector3(0, 1, 0).transformDirection(matrix);
            assert.ok(Math.abs(direction.z) > 1 - 1e-10 ? up.y > 0.999999 : up.z > 0, 'upright camera');
        }
    }
    const pose = document().camera_rig.cameras[0].pose;
    assert.throws(() => cameraPoseLookingAt(pose, pose.translation_m), /same position/);
    assert.throws(() => cameraPoseLookingAt(pose, [NaN, 0, 0]), /finite numbers/);
});

test('T matrix rejects malformed, scaled, reflected, sheared or nonfinite transforms', () => {
    const identity = matrixRows(new Matrix4());
    for (const mutate of [
        rows => { rows[0][0] = 2; }, rows => { rows[0][0] = -1; },
        rows => { rows[0][1] = 0.2; }, rows => { rows[3][0] = 1; },
        rows => { rows[0][3] = NaN; }
    ]) {
        const rows = structuredClone(identity); mutate(rows);
        assert.throws(() => poseFromRows(rows), /T must/);
    }
    assert.throws(() => poseFromRows([1, 2, 3]), /T must/);
});

test('round-trips existing scenes and preserves unknown fields and trajectories', async () => {
    for (const filename of [
        'SynC/scenes/linear_motion/params.json',
        'SynC/scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json',
        'SynC/scenes/ingress/params.json'
    ]) {
        const doc = JSON.parse(await readFile(path.join(root, filename), 'utf8'));
        doc.custom_metadata = { test: ['preserved', 42] };
        validateComposerDocument(doc);
        assert.deepEqual(JSON.parse(JSON.stringify(doc)).custom_metadata, doc.custom_metadata);
    }
    const stereo = JSON.parse(await readFile(path.join(root, 'SynC/scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json'), 'utf8'));
    stereo.camera_rig.cameras[0].pose.translation_m[1] += 1;
    assert.throws(() => validateComposerDocument(stereo), /baseline/);
});

test('validates scene configuration and safe model/output paths', () => {
    for (const mutate of [
        doc => { doc.scene.units = 'feet'; },
        doc => { doc.scene.render.resolution_px = [0, 964]; },
        doc => { doc.scene.render.samples = -1; },
        doc => { doc.camera_rig.cameras[0].clip_end_m = 0.01; },
        doc => { doc.models[0].file = '../outside.glb'; },
        doc => { doc.environment.sun.direction.elevation_deg = 100; },
        doc => { doc.output.log_filename = '../outside.json'; },
        doc => { doc.output.camera_directories = { Camera: '../outside' }; }
    ]) {
        const doc = document(); mutate(doc);
        assert.throws(() => validateComposerDocument(doc));
    }
});

test('configured folders resolve relative, absolute and home paths', () => {
    assert.equal(configuredFolder(root, 'SynC/models'), path.join(root, 'SynC/models'));
    assert.equal(configuredFolder(root, '~/scenes'), path.join(os.homedir(), 'scenes'));
    assert.equal(configuredFolder(root, '/tmp/scenes'), '/tmp/scenes');
    assert.throws(() => configuredFolder(root, ''), /nonempty/);
});

test('catalog and atomic scene CRUD persist full scene JSON without touching models', async t => {
    const { modelsDir, scenesDir, storage } = await fixture(t);
    const doc = document();
    doc.trajectory = { type: 'linear', object: 'cassini', frame: 'world', start_position_m: [0, 30, 0], end_position_m: [1, 30, 0], max_step_m: 0.5 };
    const catalog = await storage.catalog();
    assert.deepEqual(catalog.models, ['Cassini-Huygens (A).glb']);
    assert.deepEqual(catalog.scenes, []);
    const saved = await storage.save('test.json', doc);
    assert.equal(saved.path, path.join(await realpath(scenesDir), 'test.json'));
    assert.deepEqual((await storage.load('test.json')).document, doc);
    assert.deepEqual((await storage.importFile(saved.path)).document, doc);
    await assert.rejects(storage.save('test.json', doc), /already exists/);
    doc.scene.name = 'Modified';
    await storage.save('test.json', doc, true);
    assert.equal((await storage.load('test.json')).document.scene.name, 'Modified');
    assert.equal(new TextDecoder().decode(await storage.model('Cassini-Huygens (A).glb')), 'test model');
    assert.deepEqual(await readdir(scenesDir), ['test.json']);
    await storage.delete('test.json');
    assert.deepEqual((await storage.catalog()).scenes, []);
    assert.equal(await readFile(path.join(modelsDir, 'Cassini-Huygens (A).glb'), 'utf8'), 'test model');
});

test('storage rejects traversal, symbolic links, invalid scene documents and stale overwrites', async t => {
    const { directory, modelsDir, scenesDir, storage } = await fixture(t);
    await storage.catalog();
    await writeFile(path.join(directory, 'outside.glb'), 'outside');
    await symlink(path.join(directory, 'outside.glb'), path.join(modelsDir, 'linked.glb'));
    await assert.rejects(storage.model('linked.glb'), /regular files/);
    await assert.rejects(storage.model('../outside.glb'), /filename/);
    await assert.rejects(storage.load('../outside.json'), /filename/);
    await assert.rejects(storage.save('../outside.json', document()), /filename/);
    await assert.rejects(storage.save('missing.json', document(), true), /no longer exists/);
    await assert.rejects(storage.save('blank.json', newSceneDocument()), /uniquely named/);
    await writeFile(path.join(directory, 'outside.json'), JSON.stringify(document()));
    await symlink(path.join(directory, 'outside.json'), path.join(scenesDir, 'linked.json'));
    await assert.rejects(storage.save('linked.json', document(), true), /regular files/);
    await assert.rejects(storage.delete('linked.json'), /regular files/);
    await writeFile(path.join(scenesDir, 'invalid.json'), '{}');
    await assert.rejects(storage.load('invalid.json'), /Expected/);
});

test('workflow renderer uses configured model directory in asset checks and Blender arguments', async t => {
    const { directory, modelsDir } = await fixture(t);
    const doc = document();
    const result = await renderSyntheticScene({ params_file: path.join(directory, 'scene.json'), config_json: JSON.stringify(doc) }, {
        appDir: root, modelsDir, runDir: directory, blender: 'blender', isAllowed: () => true,
        async render(_, args) {
            assert.equal(args[args.indexOf('--models-dir') + 1], modelsDir);
            const out = args[args.indexOf('--output-dir') + 1];
            await writeFile(path.join(out, 'image.png'), 'fixture');
            await writeFile(path.join(out, 'render_manifest.json'), JSON.stringify({ frames: [{ images: { Camera: 'image.png' } }] }));
        }
    });
    assert.equal(result.files.length, 1);
});

test('splitting a composer tab retains scene data without sharing edits or overwriting original', () => {
    const model = new TabModel();
    const id = model.addTab({ label: 'Scene', type: 'scene-composer' });
    const original = model.getTab(id);
    original.composer = { document: document(), file: 'saved.json', undo: [], redo: [] };
    const group = model.splitGroup(model.activeGroupId);
    assert.ok(group);
    const copied = model.getActiveTab();
    assert.deepEqual(copied.composer.document, original.composer.document);
    assert.equal(copied.composer.file, null);
    copied.composer.document.scene.name = 'Copy';
    assert.notEqual(copied.composer.document.scene.name, original.composer.document.scene.name);
});
