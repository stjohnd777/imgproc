import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { parseSceneDocument, SCENE_MAX_BYTES } from './scene_document.js';

const ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
const reverseOrder = order => order.split('').reverse().join('');
const vector = (values, label) => {
    if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) {
        throw new Error(`${label} must contain three finite numbers.`);
    }
    return values;
};

export function newSceneDocument() {
    return {
        schema_version: 1,
        scene: {
            name: 'Untitled scene', units: 'meters',
            world_frame: { name: 'world', handedness: 'right_handed', axes: { x: 'right', y: 'forward', z: 'up' } },
            render: {
                engine: 'BLENDER_EEVEE_NEXT', resolution_px: [1288, 964], resolution_percentage: 100,
                image_format: 'PNG', color_mode: 'RGB', color_depth: '8', samples: 64
            }
        },
        camera_rig: { name: 'Scene cameras', cameras: [] },
        models: [],
        environment: {
            background: { color_rgb: [0, 0, 0], strength: 0 },
            sun: {
                enabled: true,
                direction: {
                    representation: 'azimuth_elevation', frame: 'world', azimuth_deg: 180, elevation_deg: 30,
                    azimuth_zero_direction: '+Y', azimuth_increases_toward: '+X',
                    elevation_reference_plane: 'XY', vector_points: 'scene_toward_sun'
                },
                apparent_angular_diameter_deg: 0.533, blender_energy: 4.5, color_temperature_k: 5778
            },
            earth: { visible: false, illumination: { enabled: false } },
            moon: { visible: false, illumination: { enabled: false } }, stars: { visible: false }
        },
        output: { prefix: 'scene', log_filename: 'render_manifest.json' }
    };
}

export function poseMatrix(pose) {
    if (pose?.frame !== 'world') throw new Error('Poses must use the world frame.');
    const translation = vector(pose.translation_m, 'Translation');
    const rotation = vector(pose.rotation_euler_rad, 'Rotation');
    const order = pose.rotation_order ?? 'XYZ';
    if (!ORDERS.includes(order)) throw new Error(`Unsupported rotation order: ${order}`);
    // Blender applies XYZ as Rz * Ry * Rx; Three uses the reverse convention.
    const quaternion = new Quaternion().setFromEuler(new Euler(...rotation, reverseOrder(order)));
    return new Matrix4().compose(new Vector3(...translation), quaternion, new Vector3(1, 1, 1));
}

export function matrixRows(matrix) {
    return Array.from({ length: 4 }, (_, row) =>
        Array.from({ length: 4 }, (_, column) => matrix.elements[column * 4 + row]));
}

export function cameraPoseLookingAt(pose, targetPosition) {
    poseMatrix(pose);
    const eye = new Vector3(...pose.translation_m);
    const target = new Vector3(...vector(targetPosition, 'Target position'));
    const forward = target.clone().sub(eye);
    if (forward.length() <= 1e-9) throw new Error('Camera and target are at the same position. Move the camera or target before aiming.');
    forward.normalize();
    // Z-up cannot define roll when looking vertically; use world +Y in that case.
    const up = Math.abs(forward.z) > 1 - 1e-10 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    const matrix = new Matrix4().lookAt(eye, target, up).setPosition(eye);
    return { ...pose, ...poseFromRows(matrixRows(matrix), pose.rotation_order ?? 'XYZ') };
}

export function poseFromRows(rows, order = 'XYZ') {
    if (!ORDERS.includes(order) || !Array.isArray(rows) || rows.length !== 4 ||
        rows.some(row => !Array.isArray(row) || row.length !== 4 || !row.every(Number.isFinite))) {
        throw new Error('T must be a finite row-major 4 x 4 matrix.');
    }
    const epsilon = 1e-6;
    if (rows[3].some((value, i) => Math.abs(value - (i === 3 ? 1 : 0)) > epsilon)) {
        throw new Error('T must end with [0, 0, 0, 1].');
    }
    const matrix = new Matrix4().set(...rows.flat());
    const columns = [0, 1, 2].map(column => new Vector3(...rows.slice(0, 3).map(row => row[column])));
    if (columns.some(column => Math.abs(column.lengthSq() - 1) > epsilon) ||
        Math.abs(columns[0].dot(columns[1])) > epsilon ||
        Math.abs(columns[0].dot(columns[2])) > epsilon ||
        Math.abs(columns[1].dot(columns[2])) > epsilon ||
        Math.abs(matrix.determinant() - 1) > epsilon) {
        throw new Error('T must be a rigid pose: no scale, shear, or reflection.');
    }
    const rotation = new Euler().setFromRotationMatrix(matrix, reverseOrder(order));
    return {
        frame: 'world', translation_m: rows.slice(0, 3).map(row => row[3]),
        rotation_euler_rad: [rotation.x, rotation.y, rotation.z], rotation_order: order
    };
}

export function cameraProjection(camera, resolution) {
    for (const name of ['focal_length_mm', 'sensor_width_mm', 'sensor_height_mm', 'clip_start_m', 'clip_end_m']) {
        if (!Number.isFinite(camera[name]) || camera[name] <= 0) throw new Error(`Camera ${name} must be positive.`);
    }
    if (camera.clip_end_m <= camera.clip_start_m) throw new Error('Camera far clip must exceed near clip.');
    const [width, height] = resolution;
    const aspect = width / height;
    const fit = camera.sensor_fit === 'AUTO' ? (width >= height ? 'HORIZONTAL' : 'VERTICAL') : camera.sensor_fit;
    if (!['HORIZONTAL', 'VERTICAL'].includes(fit)) throw new Error('Unsupported camera sensor fit.');
    const verticalSensor = fit === 'HORIZONTAL' ? camera.sensor_width_mm / aspect : camera.sensor_height_mm;
    return { fov: 2 * Math.atan(verticalSensor / (2 * camera.focal_length_mm)) * 180 / Math.PI, aspect };
}

export function cameraFromProfile(spec, name) {
    const width = spec?.sensor?.activeAreaMm?.width;
    const height = spec?.sensor?.activeAreaMm?.height;
    const focal = spec?.lens?.focalLengthMm;
    if (![width, height, focal].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('This camera profile needs positive sensor activeAreaMm width/height and lens focalLengthMm. Use Generic Camera and enter them manually.');
    }
    return {
        name, focal_length_mm: focal, sensor_width_mm: width, sensor_height_mm: height,
        sensor_fit: 'HORIZONTAL', clip_start_m: 0.1, clip_end_m: 2000,
        pose: { frame: 'world', translation_m: [0, 0, 0], rotation_euler_rad: [Math.PI / 2, 0, 0], rotation_order: 'XYZ' }
    };
}

export function uniqueSceneName(document, base) {
    const names = new Set([...document.models, ...document.camera_rig.cameras].map(item => item.name));
    let name = base;
    for (let index = 2; names.has(name); index++) name = `${base} ${index}`;
    return name;
}

export function validateComposerDocument(document, complete = true) {
    const text = JSON.stringify(document);
    if (!text || new TextEncoder().encode(text).length > SCENE_MAX_BYTES) throw new Error('Scene JSON exceeds 1 MB.');
    if (complete) parseSceneDocument(text);
    if (document.schema_version !== 1 || !Array.isArray(document.models) || !Array.isArray(document.camera_rig?.cameras)) {
        throw new Error('Expected a SynC schema_version 1 scene.');
    }
    const scene = document.scene;
    const world = scene?.world_frame;
    if (scene?.units !== 'meters' || world?.name !== 'world' || world.handedness !== 'right_handed' ||
        world.axes?.x !== 'right' || world.axes?.y !== 'forward' || world.axes?.z !== 'up') {
        throw new Error('Scene must use meters and right-handed world X right, Y forward, Z up.');
    }
    if (typeof scene.name !== 'string' || !scene.name.trim() ||
        typeof document.camera_rig.name !== 'string' || !document.camera_rig.name.trim()) throw new Error('Scene and camera rig need names.');
    const resolution = scene.render?.resolution_px;
    if (!Array.isArray(resolution) || resolution.length !== 2 ||
        !resolution.every(value => Number.isInteger(value) && value > 0 && value <= 16384)) throw new Error('Resolution must contain two integers from 1 to 16384.');
    const render = scene.render;
    if (typeof render.engine !== 'string' || !['PNG', 'JPEG', 'BMP', 'TIFF', 'OPEN_EXR'].includes(render.image_format) ||
        !['BW', 'RGB', 'RGBA'].includes(render.color_mode) || !['8', '16', '32'].includes(render.color_depth ?? '8')) throw new Error('Unsupported render configuration.');
    const percentage = render.resolution_percentage ?? 100;
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100 ||
        resolution.some(value => Math.floor(value * percentage / 100) < 1)) throw new Error('Invalid resolution percentage or scaled render dimensions.');
    if (render.samples !== undefined && (!Number.isInteger(render.samples) || render.samples <= 0)) throw new Error('Render samples must be a positive integer.');
    const names = new Set();
    for (const entry of [...document.models, ...document.camera_rig.cameras]) {
        if (typeof entry.name !== 'string' || !entry.name.trim() || names.has(entry.name)) throw new Error('Object names must be nonempty and unique.');
        names.add(entry.name);
        poseMatrix(entry.pose);
    }
    for (const model of document.models) {
        if (typeof model.file !== 'string' || !/^[^/\\]+\.glb$/i.test(model.file)) throw new Error('Models must reference GLB filenames in the configured model folder.');
    }
    for (const camera of document.camera_rig.cameras) {
        cameraProjection({ clip_start_m: 0.1, clip_end_m: 2000, ...camera }, resolution);
        if ((camera.resolution_x ?? resolution[0]) !== resolution[0] ||
            (camera.resolution_y ?? resolution[1]) !== resolution[1]) throw new Error('Camera resolution must match scene resolution.');
    }
    const rig = document.camera_rig;
    if (rig.baseline_m !== undefined) {
        const cameras = rig.cameras;
        if (cameras.length !== 2 || !Number.isFinite(rig.baseline_m) || rig.baseline_m <= 0 || rig.baseline_axis !== '+X' ||
            cameras[1].pose.translation_m.some((value, i) =>
                Math.abs(value - cameras[0].pose.translation_m[i] - (i === 0 ? rig.baseline_m : 0)) > Math.max(1e-9, rig.baseline_m * 1e-6))) {
            throw new Error('Camera poses do not match the stereo baseline. Update/remove baseline_m and baseline_axis in Scene JSON before independent camera edits.');
        }
        if (rig.parallel_optical_axes &&
            ((cameras[0].pose.rotation_order ?? 'XYZ') !== (cameras[1].pose.rotation_order ?? 'XYZ') ||
                cameras[0].pose.rotation_euler_rad.some((value, i) => Math.abs(value - cameras[1].pose.rotation_euler_rad[i]) > 1e-9))) {
            throw new Error('Stereo rig requires parallel camera rotations. Update/remove the constraint in Scene JSON first.');
        }
    }
    const background = document.environment?.background;
    vector(background?.color_rgb, 'Background RGB');
    if (background.color_rgb.some(value => value < 0) || !Number.isFinite(background.strength) || background.strength < 0) throw new Error('Background values must be nonnegative.');
    const sun = document.environment?.sun;
    if (!sun || typeof sun.enabled !== 'boolean') throw new Error('Scene needs a Sun configuration.');
    if (sun.enabled) {
        const direction = sun.direction;
        if (direction?.representation !== 'azimuth_elevation' || direction.frame !== 'world' ||
            direction.azimuth_zero_direction !== '+Y' || direction.azimuth_increases_toward !== '+X' ||
            direction.elevation_reference_plane !== 'XY' || direction.vector_points !== 'scene_toward_sun' ||
            !Number.isFinite(direction.azimuth_deg) || !Number.isFinite(direction.elevation_deg) ||
            Math.abs(direction.elevation_deg) > 90) throw new Error('Unsupported Sun direction or elevation.');
        for (const field of ['blender_energy', 'color_temperature_k', 'apparent_angular_diameter_deg']) {
            if (!Number.isFinite(sun[field]) || sun[field] < 0 ||
                (field === 'color_temperature_k' && sun[field] === 0) ||
                (field === 'apparent_angular_diameter_deg' && sun[field] > 180)) throw new Error(`Invalid Sun ${field}.`);
        }
    }
    for (const name of ['prefix', 'log_filename']) {
        const value = document.output?.[name];
        if (value !== undefined && (typeof value !== 'string' || !value || /[/\\]/.test(value) || value === '.' || value === '..')) throw new Error(`Invalid output ${name}.`);
    }
    for (const value of Object.values(document.output?.camera_directories ?? {})) {
        if (typeof value !== 'string' || !value || /^[\\/]/.test(value) ||
            value.split(/[\\/]/).includes('..') || /^[A-Za-z]:/.test(value)) throw new Error('Camera output folders must be relative and cannot escape the output directory.');
    }
    return document;
}
