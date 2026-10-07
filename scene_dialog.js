import { parseSceneDocument, selectSceneCamera, renameSceneModel } from './scene_document.js';

export async function showSceneDialog(view, tab, node, element) {
    const backdrop = view.thresholdModal;
    backdrop.replaceChildren();
    backdrop.hidden = false;
    const form = document.createElement('form');
    form.className = 'modal modal-wide';
    const title = document.createElement('h2');
    title.textContent = `${node.name} parameters`;
    const help = document.createElement('p');
    help.className = 'modal-help';
    help.textContent = 'Edits are stored in this workflow; the original file is unchanged. The full rig is rendered, but only the selected camera feeds image. Camera poses/optics, render settings and trajectories can be edited in Advanced JSON; Blender validates the complete schema when rendering.';
    const error = document.createElement('p');
    error.className = 'modal-help';
    error.setAttribute('role', 'alert');
    form.append(title, help);
    function field(label, type = 'text') {
        const row = document.createElement('label');
        row.className = 'form-row';
        row.append(document.createTextNode(label));
        const input = document.createElement(type === 'select' ? 'select' : 'input');
        if (type !== 'select') input.type = type;
        row.append(input);
        form.append(row);
        return { row, input };
    }
    const file = field('Scene JSON').input;
    file.value = node.params?.params_file ?? element.params.params_file.default;
    const load = document.createElement('button');
    load.type = 'button';
    load.textContent = 'Load file (replace edits)';
    const browse = document.createElement('button');
    browse.type = 'button';
    browse.textContent = 'Browse JSON';
    form.append(load, browse);
    const camera = field('Output camera', 'select').input;
    const fps = field('Playback FPS', 'number').input;
    fps.value = node.params?.fps ?? 5;
    fps.min = 0.1; fps.max = 60; fps.step = 'any'; fps.required = true;
    const azimuth = field('Sun azimuth (deg)', 'number').input;
    const elevation = field('Sun elevation (deg)', 'number').input;
    azimuth.step = elevation.step = 'any';
    elevation.min = -90; elevation.max = 90;
    const models = document.createElement('div');
    form.append(models);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced JSON — complete scene and camera rig';
    const json = document.createElement('textarea');
    json.rows = 18;
    json.style.width = '100%';
    json.style.fontFamily = 'monospace';
    json.spellcheck = false;
    json.setAttribute('aria-label', 'Scene JSON editor');
    const applyJson = document.createElement('button');
    applyJson.type = 'button';
    applyJson.textContent = 'Apply JSON to fields';
    details.append(summary, json, applyJson);
    form.append(details, error);
    let scene = null;
    let jsonDirty = false;
    let loading = false;
    function refresh() {
        const selected = camera.value || node.params?.camera_name;
        camera.replaceChildren();
        for (const entry of scene.camera_rig.cameras) {
            const option = document.createElement('option');
            option.value = option.textContent = entry.name;
            camera.append(option);
        }
        camera.value = scene.camera_rig.cameras.some(entry => entry.name === selected)
            ? selected : scene.camera_rig.cameras[0].name;
        const direction = scene.environment.sun?.direction;
        const supported = direction?.representation === 'azimuth_elevation';
        azimuth.disabled = elevation.disabled = !supported;
        azimuth.required = elevation.required = supported;
        azimuth.value = supported ? direction.azimuth_deg : '';
        elevation.value = supported ? direction.elevation_deg : '';
        models.replaceChildren();
        scene.models.forEach((model, index) => {
            for (const key of ['name', 'file']) {
                const row = document.createElement('label');
                row.className = 'form-row';
                row.append(document.createTextNode(`Model ${index + 1} ${key}`));
                const input = document.createElement('input');
                input.value = model[key];
                input.required = true;
                input.addEventListener('input', () => {
                    if (jsonDirty) return;
                    if (key === 'name') renameSceneModel(scene, index, input.value);
                    else model.file = input.value;
                    syncJson();
                });
                row.append(input);
                models.append(row);
            }
        });
        syncJson();
    }
    function syncJson() {
        json.value = JSON.stringify(scene, null, 2);
        jsonDirty = false;
    }
    function adoptJson() {
        const next = parseSceneDocument(json.value);
        scene = next;
        jsonDirty = false;
        refresh();
    }
    json.addEventListener('input', () => {
        jsonDirty = true;
        error.textContent = 'Apply JSON to fields before editing the simple fields. Save also applies JSON.';
        models.querySelectorAll('input').forEach(input => { input.disabled = true; });
        azimuth.disabled = elevation.disabled = true;
        azimuth.required = elevation.required = false;
    });
    applyJson.addEventListener('click', () => {
        try { adoptJson(); error.textContent = ''; }
        catch (err) { error.textContent = err.message; }
    });
    for (const [input, key] of [[azimuth, 'azimuth_deg'], [elevation, 'elevation_deg']]) {
        input.addEventListener('input', () => {
            if (!scene || jsonDirty) return;
            scene.environment.sun.direction[key] = Number(input.value);
            syncJson();
        });
    }
    async function loadFile() {
        loading = true;
        save.disabled = load.disabled = browse.disabled = true;
        try {
            const text = await window.workflow.readScene(file.value);
            scene = parseSceneDocument(text);
            refresh();
            error.textContent = '';
        } catch (err) { error.textContent = err.message; }
        finally {
            loading = false;
            save.disabled = !scene;
            load.disabled = browse.disabled = false;
        }
    }
    load.addEventListener('click', loadFile);
    browse.addEventListener('click', async () => {
        try {
            const chosen = await window.explorer.chooseFile({
                filters: [{ name: 'Scene JSON', extensions: ['json'] }]
            });
            if (!chosen) return;
            file.value = chosen.file;
            await loadFile();
        } catch (err) { error.textContent = err.message; }
    });
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { backdrop.hidden = true; });
    const save = document.createElement('button');
    save.type = 'submit'; save.textContent = 'Save'; save.className = 'primary';
    save.disabled = true;
    actions.append(cancel, save);
    form.append(actions);
    backdrop.append(form);
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (loading || !scene) return;
        try {
            if (jsonDirty) adoptJson();
            parseSceneDocument(JSON.stringify(scene));
            const cameraName = selectSceneCamera(scene, camera.value);
            view.controller.setWorkflowNodeParams(tab.id, node.id, {
                params_file: file.value, config_json: JSON.stringify(scene, null, 2),
                camera_name: cameraName, fps: Number(fps.value)
            });
            backdrop.hidden = true;
        } catch (err) { error.textContent = err.message; }
    });
    if (node.params?.config_json) {
        try {
            scene = parseSceneDocument(node.params.config_json);
            refresh();
            save.disabled = false;
        } catch (err) { error.textContent = err.message; }
    } else await loadFile();
}
