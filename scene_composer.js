import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
    newSceneDocument, validateComposerDocument, poseMatrix, matrixRows, poseFromRows,
    cameraProjection, cameraFromProfile, uniqueSceneName, cameraPoseLookingAt
} from './scene_composer_document.js';
import { renameSceneModel } from './scene_document.js';

const DRAG_TYPE = 'application/x-scene-asset';
const genericProfile = { name: 'Generic Camera', sensor: { activeAreaMm: { width: 4.83, height: 3.615 } }, lens: { focalLengthMm: 12 } };

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function disposeObject(object) {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    object.traverse(child => {
        if (child.geometry) geometries.add(child.geometry);
        for (const material of child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []) {
            materials.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
    });
    for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
}

export function mountSceneComposer(host, tab, onChange = () => {}) {
    const api = window.sceneComposer;
    const state = tab.composer ??= {
        document: newSceneDocument(), file: null, selected: null, undo: [], redo: [], view: null
    };
    let disposed = false, busy = false, generation = 0, previewAsset = null;
    let catalog = null, profiles = [], renderCamera = null;
    const assetPromises = new Map(), roots = new Map(), helpers = [];
    const draco = new DRACOLoader();
    draco.setDecoderPath(new URL('./node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url).href);
    const shell = element('div', 'scene-composer');
    const toolbar = element('div', 'scene-composer-toolbar');
    const body = element('div', 'scene-composer-body');
    const palette = element('aside', 'scene-composer-palette');
    const center = element('div', 'scene-composer-center');
    const viewport = element('div', 'scene-composer-viewport');
    const divider = element('div', 'scene-composer-divider');
    const inspector = element('aside', 'scene-composer-inspector');
    const status = element('div', 'scene-composer-status', 'Preparing scene composer...');
    center.append(viewport);
    body.append(palette, center, divider, inspector);
    shell.append(toolbar, body, status);
    host.append(shell);
    state.inspectorWidth = Number.isFinite(state.inspectorWidth) ? state.inspectorWidth : 380;
    function setInspectorWidth(width) {
        const bounds = body.getBoundingClientRect();
        const minViewport = Math.min(220, Math.max(140, bounds.width * 0.24));
        const maxInspector = Math.max(180, Math.min(700, bounds.width - 210 - minViewport - 8));
        const minInspector = Math.min(270, maxInspector);
        state.inspectorWidth = Math.round(Math.max(minInspector, Math.min(maxInspector, width)));
        body.style.setProperty('--scene-inspector-width', `${state.inspectorWidth}px`);
        divider.setAttribute('aria-valuemin', String(minInspector));
        divider.setAttribute('aria-valuemax', String(maxInspector));
        divider.setAttribute('aria-valuenow', String(state.inspectorWidth));
    }
    setInspectorWidth(state.inspectorWidth);
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', 'Resize Scene Composer properties pane');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.tabIndex = 0;
    const startResize = event => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        divider.setPointerCapture?.(event.pointerId);
        shell.classList.add('resizing-pane');
        const move = pointer => {
            const rect = body.getBoundingClientRect();
            setInspectorWidth(rect.right - pointer.clientX);
        };
        const finish = () => {
            shell.classList.remove('resizing-pane');
            divider.removeEventListener('pointermove', move);
            divider.removeEventListener('pointerup', finish);
            divider.removeEventListener('pointercancel', finish);
        };
        divider.addEventListener('pointermove', move);
        divider.addEventListener('pointerup', finish);
        divider.addEventListener('pointercancel', finish);
    };
    divider.addEventListener('pointerdown', startResize);
    divider.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setInspectorWidth(state.inspectorWidth + (event.key === 'ArrowLeft' ? 24 : -24));
    });
    new ResizeObserver(() => setInspectorWidth(state.inspectorWidth)).observe(body);

    function report(message, error = false) {
        if (disposed) return;
        status.textContent = message;
        status.classList.toggle('error', error);
    }
    const guard = action => async () => {
        try { await action(); }
        catch (error) { console.error('Scene Composer:', error); report(error.message, true); }
    };
    function button(parent, label, action, title) {
        const node = element('button', '', label);
        node.type = 'button';
        if (title) node.title = title;
        node.addEventListener('click', guard(action));
        parent.append(node);
        return node;
    }
    if (!api) {
        report('Scene Composer requires Electron. Restart the app to load its new preload API.', true);
        return { dispose() { disposed = true; } };
    }

    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch (error) {
        report(`WebGL viewport unavailable: ${error.message}`, true);
        return { dispose() { disposed = true; } };
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x151b25);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.append(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D scene viewport');
    const scene = new THREE.Scene();
    const content = new THREE.Group();
    scene.add(content);
    const editorCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000000);
    editorCamera.up.set(0, 0, 1);
    editorCamera.position.fromArray(state.view?.position ?? [40, -50, 40]);
    const orbit = new OrbitControls(editorCamera, renderer.domElement);
    orbit.target.fromArray(state.view?.target ?? [0, 15, 0]);
    orbit.update();
    const transform = new TransformControls(editorCamera, renderer.domElement);
    transform.setSpace('world');
    scene.add(transform.getHelper());
    const grid = new THREE.GridHelper(200, 40, 0x52627c, 0x283447);
    grid.rotation.x = Math.PI / 2;
    const axes = new THREE.AxesHelper(10);
    scene.add(grid, axes);
    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    scene.add(ambient, sun);
    const raycaster = new THREE.Raycaster();
    const resize = () => {
        if (disposed) return;
        const width = Math.max(viewport.clientWidth, 1), height = Math.max(viewport.clientHeight, 1);
        renderer.setSize(width, height);
        editorCamera.aspect = width / height;
        editorCamera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    renderer.setAnimationLoop(() => {
        orbit.update();
        if (!renderCamera) {
            renderer.setViewport(0, 0, viewport.clientWidth, viewport.clientHeight);
            renderer.setScissorTest(false);
        } else {
            const width = viewport.clientWidth, height = viewport.clientHeight;
            const aspect = renderCamera.aspect;
            const w = Math.min(width, height * aspect), h = w / aspect;
            renderer.setScissorTest(false);
            renderer.clear();
            renderer.setViewport((width - w) / 2, (height - h) / 2, w, h);
            renderer.setScissor((width - w) / 2, (height - h) / 2, w, h);
            renderer.setScissorTest(true);
        }
        renderer.render(scene, renderCamera ?? editorCamera);
    });
    function sceneView() {
        if (previewAsset) content.remove(previewAsset);
        previewAsset = null;
        renderCamera = null;
        orbit.enabled = true;
        grid.visible = axes.visible = true;
        for (const root of roots.values()) root.visible = true;
        for (const helper of helpers) helper.visible = true;
        if (state.selected && roots.has(state.selected)) transform.attach(roots.get(state.selected));
    }
    function frameObject(object = content) {
        sceneView();
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) { orbit.target.set(0, 15, 0); editorCamera.position.set(40, -50, 40); }
        else {
            const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
            const distance = Math.max(size.length(), 1) / (2 * Math.tan(THREE.MathUtils.degToRad(editorCamera.fov / 2))) * 1.4;
            orbit.target.copy(center);
            editorCamera.position.copy(center).add(new THREE.Vector3(1, -1.5, 0.9).normalize().multiplyScalar(distance));
        }
        orbit.update();
    }
    function remember() {
        tab.dirty = true;
        tab.label = `${state.document.scene.name}`;
        onChange();
    }
    function entryFor(key = state.selected, document = state.document) {
        if (!key) return null;
        const [kind, name] = JSON.parse(key);
        const entries = kind === 'model' ? document.models : document.camera_rig.cameras;
        return { kind, entry: entries.find(item => item.name === name), entries };
    }
    function keyFor(kind, entry) { return JSON.stringify([kind, entry.name]); }
    async function change(edit) {
        if (busy) throw new Error('Wait for the current scene operation to finish.');
        const before = JSON.stringify(state.document), candidate = structuredClone(state.document);
        const previousSelection = state.selected;
        try { edit(candidate); validateComposerDocument(candidate, false); }
        catch (error) { state.selected = previousSelection; throw error; }
        state.undo.push(before);
        if (state.undo.length > 50) state.undo.shift();
        state.redo = [];
        state.document = candidate;
        remember();
        await rebuild();
    }
    function select(key) {
        sceneView();
        state.selected = key;
        transform.detach();
        if (roots.has(key)) transform.attach(roots.get(key));
        renderInspector();
        renderTree();
    }
    let beforeDrag = null;
    transform.addEventListener('dragging-changed', event => {
        orbit.enabled = !event.value;
        if (event.value) beforeDrag = JSON.stringify(state.document);
        else if (beforeDrag) {
            const previous = beforeDrag;
            beforeDrag = null;
            guard(async () => {
                const root = transform.object;
                if (!root) return;
                root.updateMatrix();
                const selected = entryFor();
                const candidate = structuredClone(state.document);
                entryFor(state.selected, candidate).entry.pose = poseFromRows(matrixRows(root.matrix), selected.entry.pose.rotation_order ?? 'XYZ');
                try { validateComposerDocument(candidate, false); }
                catch (error) { await rebuild(); throw error; }
                state.undo.push(previous);
                if (state.undo.length > 50) state.undo.shift();
                state.redo = [];
                state.document = candidate;
                remember();
                await rebuild();
            })();
        }
    });
    let pointerStart;
    renderer.domElement.addEventListener('pointerdown', event => { pointerStart = [event.clientX, event.clientY]; });
    renderer.domElement.addEventListener('pointerup', event => {
        if (renderCamera || previewAsset || !pointerStart || transform.axis ||
            Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 4) return;
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(
            2 * (event.clientX - rect.left) / rect.width - 1,
            1 - 2 * (event.clientY - rect.top) / rect.height
        ), editorCamera);
        const hits = raycaster.intersectObjects([...roots.values()], true);
        let object = hits[0]?.object;
        while (object && !object.userData.composerKey) object = object.parent;
        select(object?.userData.composerKey ?? null);
    });

    async function asset(file) {
        if (!assetPromises.has(file)) {
            const promise = (async () => {
                const bytes = await api.model(file);
                const data = new Uint8Array(bytes);
                const manager = new THREE.LoadingManager();
                manager.setURLModifier(url => {
                    if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('GLB preview requires embedded resources; external URLs are not allowed.');
                    return url;
                });
                const gltf = await new GLTFLoader(manager).setDRACOLoader(draco).parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
                const source = new THREE.Group(), aligned = new THREE.Group();
                aligned.add(gltf.scene); source.add(aligned);
                // glTF is Y-up; Blender's importer converts it to Z-up.
                aligned.rotation.x = Math.PI / 2;
                source.updateMatrixWorld(true);
                const bounds = new THREE.Box3().setFromObject(source);
                if (bounds.isEmpty()) { disposeObject(source); throw new Error(`${file} contains no visible geometry.`); }
                aligned.position.sub(bounds.getCenter(new THREE.Vector3()));
                source.updateMatrixWorld(true);
                if (disposed) { disposeObject(source); throw new Error('Scene Composer closed while loading model.'); }
                return source;
            })();
            assetPromises.set(file, promise);
            promise.catch(() => { if (assetPromises.get(file) === promise) assetPromises.delete(file); });
        }
        return assetPromises.get(file);
    }
    async function rebuild() {
        const token = ++generation;
        sceneView();
        transform.detach();
        for (const helper of helpers.splice(0)) { scene.remove(helper); helper.dispose?.(); }
        for (const [key, root] of roots) if (key.startsWith('["camera"')) disposeObject(root);
        content.clear();
        roots.clear();
        const document = state.document;
        scene.background = new THREE.Color(...document.environment.background.color_rgb);
        const direction = document.environment.sun.direction;
        if (direction) {
            const az = THREE.MathUtils.degToRad(direction.azimuth_deg), el = THREE.MathUtils.degToRad(direction.elevation_deg);
            sun.position.set(Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el));
        }
        sun.intensity = document.environment.sun.enabled ? document.environment.sun.blender_energy : 0;
        renderTree();
        renderInspector();
        const failures = [];
        await Promise.all(document.models.map(async model => {
            try {
                const source = await asset(model.file);
                if (disposed || token !== generation) return;
                const root = cloneSkeleton(source);
                const key = keyFor('model', model);
                poseMatrix(model.pose).decompose(root.position, root.quaternion, root.scale);
                root.userData.composerKey = key;
                content.add(root);
                roots.set(key, root);
            } catch (error) { failures.push(`${model.name}: ${error.message}`); }
        }));
        if (disposed || token !== generation) return;
        for (const config of document.camera_rig.cameras) {
            const projection = cameraProjection({ clip_start_m: 0.1, clip_end_m: 2000, ...config }, document.scene.render.resolution_px);
            const root = new THREE.Group();
            const camera = new THREE.PerspectiveCamera(projection.fov, projection.aspect, config.clip_start_m ?? 0.1, config.clip_end_m ?? 2000);
            root.add(camera);
            const marker = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0x55bfff }));
            root.add(marker);
            const key = keyFor('camera', config);
            root.userData.composerKey = key;
            root.userData.viewCamera = camera;
            poseMatrix(config.pose).decompose(root.position, root.quaternion, root.scale);
            content.add(root);
            roots.set(key, root);
            root.updateMatrixWorld(true);
            const displayCamera = camera.clone();
            displayCamera.far = Math.min(config.clip_end_m ?? 2000, 10);
            displayCamera.near = Math.min(config.clip_start_m ?? 0.1, 0.5);
            displayCamera.updateProjectionMatrix();
            displayCamera.matrixWorld.copy(camera.matrixWorld);
            displayCamera.matrixWorldInverse.copy(camera.matrixWorld).invert();
            const helper = new THREE.CameraHelper(displayCamera);
            scene.add(helper);
            helpers.push(helper);
        }
        if (roots.has(state.selected)) transform.attach(roots.get(state.selected));
        else state.selected = null;
        if (failures.length) report(`Models could not be previewed: ${failures.join('; ')}`, true);
        else report(document.trajectory
            ? 'Trajectory preserved in JSON; viewport shows the stored poses. Blender Preview renders only this static pose.'
            : 'Meters; X right (red), Y forward (green), Z up (blue). Drag models/cameras here. Orbit: left drag; pan: right drag; zoom: wheel.');
    }
    async function addAsset(payload, position) {
        await change(document => {
            if (payload.kind === 'model') {
                if (!catalog.models.includes(payload.file)) throw new Error('Choose a model from the model palette.');
                const entry = {
                    name: uniqueSceneName(document, payload.file.replace(/\.glb$/i, '')), file: payload.file,
                    pose: { frame: 'world', translation_m: position ?? [0, 30, 0], rotation_euler_rad: [0, 0, 0], rotation_order: 'XYZ' }
                };
                document.models.push(entry);
                state.selected = keyFor('model', entry);
            } else {
                const profile = payload.file === 'generic' ? genericProfile : profiles.find(item => item.file === payload.file)?.spec;
                const entry = cameraFromProfile(profile, uniqueSceneName(document, profile?.name ?? 'Camera'));
                if (position) entry.pose.translation_m = position;
                if (!document.camera_rig.cameras.length) {
                    const resolution = profile?.sensor?.resolution;
                    if (resolution?.width > 0 && resolution?.height > 0) document.scene.render.resolution_px = [resolution.width, resolution.height];
                }
                document.camera_rig.cameras.push(entry);
                state.selected = keyFor('camera', entry);
            }
        });
    }
    viewport.addEventListener('dragover', event => { if ([...event.dataTransfer.types].includes(DRAG_TYPE)) event.preventDefault(); });
    viewport.addEventListener('drop', event => {
        const data = event.dataTransfer.getData(DRAG_TYPE);
        if (!data) return;
        event.preventDefault();
        guard(async () => {
            const rect = renderer.domElement.getBoundingClientRect();
            raycaster.setFromCamera(new THREE.Vector2(
                2 * (event.clientX - rect.left) / rect.width - 1,
                1 - 2 * (event.clientY - rect.top) / rect.height
            ), editorCamera);
            const position = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
            if (!position) throw new Error('Cannot place on the ground plane from this view. Return to Scene View and orbit above the grid.');
            sceneView();
            await addAsset(JSON.parse(data), position.toArray());
        })();
    });

    let tree;
    function renderTree() {
        if (!tree) return;
        tree.replaceChildren(element('h3', '', 'Scene objects'));
        for (const [kind, entries] of [['model', state.document.models], ['camera', state.document.camera_rig.cameras]]) {
            for (const entry of entries) {
                const key = keyFor(kind, entry);
                const node = button(tree, `${kind === 'model' ? 'Model' : 'Camera'}: ${entry.name}`, () => select(key));
                node.classList.toggle('selected', state.selected === key);
            }
        }
    }
    async function refreshCatalog() {
        const [result, cameras] = await Promise.all([api.catalog(), window.specs.list('cameras')]);
        if (disposed) return;
        catalog = result;
        profiles = cameras.filter(item => item.spec);
        palette.replaceChildren(element('h3', '', 'Saved scenes'));
        const saved = element('select');
        saved.setAttribute('aria-label', 'Saved scene');
        saved.append(element('option', '', 'Choose a saved scene'));
        saved.firstChild.value = '';
        for (const file of catalog.scenes) {
            const option = element('option', '', file); option.value = file; saved.append(option);
        }
        if (state.file) saved.value = state.file;
        palette.append(saved);
        button(palette, 'Load Scene', async () => {
            if (!saved.value) throw new Error('Choose a saved scene.');
            if (!discard()) return;
            const result = await api.load(saved.value);
            await replaceDocument(result.document, result.file);
        });
        button(palette, 'Delete Saved Scene', async () => {
            if (!saved.value) throw new Error('Choose a saved scene.');
            if (!window.confirm(`Permanently delete ${saved.value}? Models and rendered images will not be deleted.`)) return;
            await api.delete(saved.value);
            if (state.file === saved.value) { state.file = null; tab.dirty = true; onChange(); }
            await refreshCatalog();
            report('Saved scene deleted; current scene stays in the editor.');
        });
        palette.append(element('p', 'scene-folder', `Scenes: ${catalog.scenesDir}`), element('h3', '', 'Models'));
        palette.append(element('p', 'scene-folder', `Models: ${catalog.modelsDir}`));
        if (!catalog.models.length) palette.append(element('p', '', 'No GLB files found.'));
        for (const file of catalog.models) {
            const row = element('div', 'scene-asset');
            const payload = { kind: 'model', file };
            const place = button(row, file, () => addAsset(payload), 'Click to add at (0, 30, 0), or drag onto the grid');
            place.draggable = true;
            place.addEventListener('dragstart', event => event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload)));
            button(row, 'View', async () => {
                const source = await asset(file);
                if (disposed) return;
                if (previewAsset) { content.remove(previewAsset); previewAsset = null; }
                sceneView();
                const root = cloneSkeleton(source);
                content.add(root);
                frameObject(root);
                for (const item of roots.values()) item.visible = false;
                for (const helper of helpers) helper.visible = false;
                transform.detach();
                previewAsset = root;
                report(`Viewing ${file} only; not added to the scene. Use Scene View to return, or click the model name to add it.`);
            });
            palette.append(row);
        }
        palette.append(element('h3', '', 'Camera definitions'));
        for (const profile of [{ file: 'generic', spec: genericProfile }, ...profiles]) {
            const payload = { kind: 'camera', file: profile.file };
            const node = button(palette, profile.spec.name ?? profile.file, () => addAsset(payload), 'Click to add at the origin, or drag onto the grid');
            node.draggable = true;
            node.addEventListener('dragstart', event => event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload)));
        }
        for (const failure of cameras.filter(item => item.error)) palette.append(element('p', 'error', `${failure.file}: ${failure.error}`));
        tree = element('div', 'scene-object-tree');
        palette.append(tree);
        renderTree();
    }
    function field(form, label, value, type = 'number') {
        const row = element('label', 'scene-field', label);
        const input = element('input');
        input.type = type; input.value = value ?? ''; input.required = true;
        if (type === 'number') input.step = 'any';
        row.append(input); form.append(row);
        return input;
    }
    function submit(form, label, action) {
        const apply = element('button', '', label); apply.type = 'submit'; form.append(apply);
        form.addEventListener('submit', event => { event.preventDefault(); guard(action)(); });
    }
    function renderInspector() {
        inspector.replaceChildren(element('h3', '', 'Scene settings'));
        const settings = element('form');
        const doc = state.document;
        const name = field(settings, 'Scene name', doc.scene.name, 'text');
        const width = field(settings, 'Render width', doc.scene.render.resolution_px[0]);
        const height = field(settings, 'Render height', doc.scene.render.resolution_px[1]);
        const direction = doc.environment.sun.direction;
        const azimuth = field(settings, 'Sun azimuth (degrees)', direction?.azimuth_deg ?? 180);
        const elevation = field(settings, 'Sun elevation (degrees)', direction?.elevation_deg ?? 30);
        const energy = field(settings, 'Sun energy', doc.environment.sun.blender_energy ?? 4.5);
        const enabled = field(settings, 'Sun enabled', '', 'checkbox'); enabled.checked = doc.environment.sun.enabled;
        submit(settings, 'Apply Scene Settings', () => change(candidate => {
            candidate.scene.name = name.value.trim();
            candidate.scene.render.resolution_px = [Number(width.value), Number(height.value)];
            const defaults = newSceneDocument().environment.sun;
            candidate.environment.sun = {
                ...defaults, ...candidate.environment.sun, enabled: enabled.checked,
                direction: { ...defaults.direction, ...candidate.environment.sun.direction, azimuth_deg: Number(azimuth.value), elevation_deg: Number(elevation.value) },
                blender_energy: Number(energy.value)
            };
        }));
        inspector.append(settings);
        const selected = entryFor();
        if (selected?.entry) {
            inspector.append(element('h3', '', `${selected.kind} pose`));
            const form = element('form');
            const entry = selected.entry;
            const objectName = field(form, 'Object name', entry.name, 'text');
            const translation = ['X', 'Y', 'Z'].map((axis, i) => field(form, `${axis} (meters)`, entry.pose.translation_m[i]));
            const rotation = ['X', 'Y', 'Z'].map((axis, i) => field(form, `${axis} rotation (degrees)`, THREE.MathUtils.radToDeg(entry.pose.rotation_euler_rad[i])));
            form.append(element('p', '', `Euler order: ${entry.pose.rotation_order ?? 'XYZ'} (Blender convention)`));
            const cameraFields = selected.kind === 'camera'
                ? ['focal_length_mm', 'sensor_width_mm', 'sensor_height_mm', 'clip_start_m', 'clip_end_m']
                    .map(key => [key, field(form, key, entry[key] ?? (key === 'clip_start_m' ? 0.1 : 2000))])
                : [];
            submit(form, 'Apply Object', () => change(candidate => {
                const target = entryFor(state.selected, candidate);
                const nextName = objectName.value.trim();
                if (target.kind === 'model') renameSceneModel(candidate, candidate.models.indexOf(target.entry), nextName);
                else {
                    const folders = candidate.output?.camera_directories;
                    if (folders && Object.hasOwn(folders, target.entry.name) && nextName !== target.entry.name) {
                        folders[nextName] = folders[target.entry.name]; delete folders[target.entry.name];
                    }
                    target.entry.name = nextName;
                }
                target.entry.pose = {
                    ...target.entry.pose, translation_m: translation.map(input => Number(input.value)),
                    rotation_euler_rad: rotation.map(input => THREE.MathUtils.degToRad(Number(input.value)))
                };
                for (const [key, input] of cameraFields) target.entry[key] = Number(input.value);
                // Update selection after validation in rebuild by using the new identity.
                state.selected = keyFor(target.kind, target.entry);
            }));
            inspector.append(form, element('h4', '', 'T: local-to-world (row-major)'));
            const matrix = element('textarea', 'scene-matrix');
            matrix.rows = 8;
            matrix.setAttribute('aria-label', 'Local-to-world T matrix');
            matrix.value = '[\n' + matrixRows(poseMatrix(entry.pose))
                .map(row => '  ' + JSON.stringify(row.map(value => Number(value.toFixed(10))))).join(',\n') + '\n]';
            inspector.append(matrix);
            button(inspector, 'Apply T Matrix', () => change(candidate => {
                entryFor(state.selected, candidate).entry.pose = poseFromRows(JSON.parse(matrix.value), entry.pose.rotation_order ?? 'XYZ');
            }));
            button(inspector, 'Frame Selected', () => frameObject(roots.get(state.selected)));
            if (selected.kind === 'camera') {
                const row = element('label', 'scene-field', 'Aim target');
                const target = element('select');
                target.setAttribute('aria-label', 'Camera aim target');
                for (const model of doc.models) {
                    const option = element('option', '', model.name);
                    option.value = model.name;
                    target.append(option);
                }
                row.append(target);
                inspector.append(row);
                const aim = button(inspector, 'Aim at Target', () => change(candidate => {
                    const model = candidate.models.find(item => item.name === target.value);
                    if (!model) throw new Error('Add a model and choose it as the camera aim target.');
                    const camera = entryFor(state.selected, candidate).entry;
                    camera.pose = cameraPoseLookingAt(camera.pose, model.pose.translation_m);
                }), 'Rotate this camera toward the chosen model center without moving it');
                aim.disabled = doc.models.length === 0;
                inspector.append(element('p', '', doc.models.length
                    ? 'Aims once at the model center using world Z-up. For vertical views, world Y sets the roll. Use Look Through Camera to check framing.'
                    : 'Add a model to aim this camera at.'));
            }
            if (selected.kind === 'camera') button(inspector, 'Look Through Camera', () => {
                sceneView();
                const root = roots.get(state.selected);
                renderCamera = root.userData.viewCamera;
                orbit.enabled = false;
                transform.detach();
                grid.visible = axes.visible = false;
                for (const [key, item] of roots) if (key.startsWith('["camera"')) item.visible = false;
                for (const helper of helpers) helper.visible = false;
                renderCamera.updateMatrixWorld(true);
                report('Camera framing preview (letterboxed to render aspect). Materials/lighting are approximate; use Blender Preview for the rendered image.');
            });
            button(inspector, 'Remove Object', () => change(candidate => {
                const target = entryFor(state.selected, candidate);
                if (candidate.trajectory?.object === target.entry.name || candidate.trajectory?.target === target.entry.name) {
                    throw new Error('This object is referenced by a trajectory. Update/remove the trajectory in Scene JSON first.');
                }
                if (target.kind === 'camera' && candidate.output?.camera_directories) delete candidate.output.camera_directories[target.entry.name];
                target.entries.splice(target.entries.indexOf(target.entry), 1);
                state.selected = null;
            }));
        }
        const advanced = element('details');
        advanced.append(element('summary', '', 'Scene JSON (advanced)'));
        const json = element('textarea', 'scene-json');
        json.rows = 20; json.spellcheck = false;
        json.setAttribute('aria-label', 'Scene JSON');
        json.value = JSON.stringify(doc, null, 2);
        advanced.append(json);
        button(advanced, 'Apply JSON', async () => {
            const document = validateComposerDocument(JSON.parse(json.value), false);
            await change(candidate => {
                for (const key of Object.keys(candidate)) delete candidate[key];
                Object.assign(candidate, document);
            });
        });
        inspector.append(advanced);
    }
    function discard() { return !tab.dirty || window.confirm('Discard unsaved scene changes?'); }
    async function replaceDocument(document, file) {
        validateComposerDocument(document, false);
        state.document = document; state.file = file; state.selected = null; state.undo = []; state.redo = [];
        tab.dirty = false; tab.label = document.scene.name; onChange();
        await rebuild(); frameObject(); await refreshCatalog();
    }
    async function save(saveAs = false) {
        if (busy) throw new Error('Wait for the current scene operation to finish.');
        validateComposerDocument(state.document);
        let file = state.file;
        if (!file || saveAs) {
            file = await filenameDialog(`${state.document.scene.name.replace(/[^\w.-]+/g, '-')}.json`);
            if (file === null) return;
            if (!file.toLowerCase().endsWith('.json')) file += '.json';
        }
        function filenameDialog(initial) {
            return new Promise(resolve => {
                const backdrop = element('div', 'scene-save-backdrop');
                const form = element('form', 'scene-save-dialog');
                form.append(element('h3', '', 'Save scene'));
                form.append(element('p', 'scene-folder', `Folder: ${catalog.scenesDir}`));
                const input = field(form, 'Filename', initial, 'text');
                const finish = value => { backdrop.remove(); resolve(value); };
                button(form, 'Cancel', () => finish(null));
                const submit = element('button', '', 'Save'); submit.type = 'submit'; form.append(submit);
                form.addEventListener('submit', event => { event.preventDefault(); finish(input.value.trim()); });
                backdrop.append(form); shell.append(backdrop); input.focus(); input.select();
            });
        }
        busy = true;
        try {
            const result = await api.save(file, structuredClone(state.document), !saveAs && Boolean(state.file));
            state.file = result.file; tab.dirty = false; onChange();
            await refreshCatalog(); report(`Saved ${result.path}`);
        } finally { busy = false; }
    }
    button(toolbar, 'New', async () => { if (discard()) await replaceDocument(newSceneDocument(), null); });
    button(toolbar, 'Import JSON', async () => {
        if (!discard()) return;
        const result = await api.import();
        if (result) await replaceDocument(result.document, null);
    });
    button(toolbar, 'Save', () => save());
    button(toolbar, 'Save As', () => save(true));
    button(toolbar, 'Undo', async () => {
        if (busy) return;
        if (!state.undo.length) return;
        state.redo.push(JSON.stringify(state.document));
        state.document = JSON.parse(state.undo.pop()); remember(); await rebuild();
    });
    button(toolbar, 'Redo', async () => {
        if (busy) return;
        if (!state.redo.length) return;
        state.undo.push(JSON.stringify(state.document));
        state.document = JSON.parse(state.redo.pop()); remember(); await rebuild();
    });
    button(toolbar, 'Move', () => { sceneView(); transform.setMode('translate'); });
    button(toolbar, 'Rotate', () => { sceneView(); transform.setMode('rotate'); });
    button(toolbar, 'Frame Scene', () => frameObject());
    button(toolbar, 'Scene View', () => { if (previewAsset) content.remove(previewAsset); sceneView(); });
    button(toolbar, 'Refresh Assets', () => refreshCatalog());
    button(toolbar, 'Blender Preview', async () => {
        if (busy) throw new Error('Wait for the current scene operation to finish.');
        validateComposerDocument(state.document);
        busy = true;
        report('Rendering a static Blender preview (25% resolution, up to 16 samples)...');
        try {
            const selected = entryFor();
            const cameraName = selected?.kind === 'camera' ? selected.entry.name : state.document.camera_rig.cameras[0].name;
            const result = await api.preview(structuredClone(state.document), cameraName, tab.id);
            if (disposed) return;
            center.querySelector('.scene-render-preview')?.remove();
            const panel = element('div', 'scene-render-preview');
            const image = element('img'); image.src = result.url; image.alt = `Blender preview: ${cameraName}`;
            panel.append(image);
            button(panel, 'Close Render Preview', () => panel.remove());
            panel.append(element('p', '', result.path));
            center.append(panel);
            report('Blender preview complete. Scene JSON was not changed.');
        } finally { busy = false; }
    });
    const onKey = event => {
        if (!host.isConnected || !host.contains(document.activeElement) && !host.parentElement?.contains(document.activeElement)) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault(); guard(() => save(event.shiftKey))();
        }
    };
    shell.tabIndex = 0;
    shell.addEventListener('pointerdown', event => { if (event.target === renderer.domElement) shell.focus({ preventScroll: true }); });
    window.addEventListener('keydown', onKey);
    guard(async () => { await refreshCatalog(); await rebuild(); resize(); })();
    return {
        dispose() {
            state.view = { position: editorCamera.position.toArray(), target: orbit.target.toArray() };
            disposed = true; generation++;
            observer.disconnect(); window.removeEventListener('keydown', onKey);
            renderer.setAnimationLoop(null); orbit.dispose(); transform.dispose();
            draco.dispose();
            for (const helper of helpers) helper.dispose?.();
            for (const [key, root] of roots) if (key.startsWith('["camera"')) disposeObject(root);
            for (const promise of assetPromises.values()) promise.then(disposeObject, () => {});
            disposeObject(grid); disposeObject(axes);
            renderer.dispose(); renderer.forceContextLoss();
        }
    };
}
