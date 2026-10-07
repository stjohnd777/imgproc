export const SCENE_MAX_BYTES = 1024 * 1024;

export function parseSceneDocument(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > SCENE_MAX_BYTES) {
        throw new Error('Scene JSON must be text no larger than 1 MB.');
    }
    const document = JSON.parse(text);
    if (document?.schema_version !== 1 || !document.scene || !document.environment) {
        throw new Error('Expected a SynC schema_version 1 scene, camera_rig, environment, and models.');
    }
    for (const [name, entries] of [['camera_rig.cameras', document.camera_rig?.cameras], ['models', document.models]]) {
        if (!Array.isArray(entries) || entries.length === 0 ||
            entries.some(entry => !entry || typeof entry.name !== 'string' || !entry.name.trim()) ||
            new Set(entries.map(entry => entry.name)).size !== entries.length) {
            throw new Error(`${name} must contain uniquely named entries.`);
        }
    }
    if (document.models.some(model => typeof model.file !== 'string' || !model.file.trim())) {
        throw new Error('Each model requires an asset file.');
    }
    const cameraNames = new Set(document.camera_rig.cameras.map(camera => camera.name));
    if (document.models.some(model => cameraNames.has(model.name))) {
        throw new Error('Camera and model names must be distinct.');
    }
    return document;
}

export function selectSceneCamera(document, name) {
    const camera = name || document.camera_rig.cameras[0].name;
    if (!document.camera_rig.cameras.some(item => item.name === camera)) {
        throw new Error(`Selected camera "${camera}" is not in camera_rig.cameras.`);
    }
    return camera;
}

export function renameSceneModel(document, index, name) {
    const previous = document.models[index].name;
    document.models[index].name = name;
    if (document.trajectory?.target === previous) document.trajectory.target = name;
    if (document.trajectory?.object === previous) document.trajectory.object = name;
}
