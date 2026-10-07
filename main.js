import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { readFile, mkdir, readdir, copyFile, writeFile, rename, unlink, stat, lstat, realpath, rm } from 'node:fs/promises';
import { rmSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { capturePhysicalCamera } from './physical_camera.js';
import { renderArgs } from './workflow_args.js';
import { uiViewResult } from './ui_view.js';
import { processTextFile } from './process_text.js';
import { executeCli } from './cli_process.js';
import { readSceneDocument, renderSyntheticScene } from './synthetic_scene.js';
import { configuredFolder, createSceneStorage } from './scene_composer_storage.js';
import { validateComposerDocument } from './scene_composer_document.js';

const APP_DIR = import.meta.dirname;
const CLI_DIR = path.join(APP_DIR, 'cv-cli');
const IMAGE_DIR = path.join(APP_DIR, 'img');
const MAPS_DIR = path.join(APP_DIR, 'maps');
const SYNC_DIR = path.join(APP_DIR, 'SynC');

// Settings live in app.json so the results location can be changed without touching code.
const DEFAULT_SETTINGS = {
    resultsDir: '~/data/navlib', toolTimeoutMs: 60_000,
    modelsDir: 'SynC/models', scenesDir: '~/data/workflows/scenes'
};

function loadSettings() {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(path.join(APP_DIR, 'app.json'), 'utf8')) };
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`app.json ignored: ${err.message}`);
        return { ...DEFAULT_SETTINGS };
    }
}

const settings = loadSettings();

function expandHome(target) {
    return target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target;
}

// The only folders the page may list specs from, keyed by the name it passes.
const SPEC_DIRS = {
    cameras: path.join(APP_DIR, 'camera_spec'),
    algorithms: path.join(APP_DIR, 'algo_spec'),
    elements: path.join(APP_DIR, 'elements')
};

// Folders whose images may be processed: the bundled img/ plus any folder the user picked in the dialog.
// The page can't add to this itself, so it can never point the tools at an arbitrary file.
const allowedFolders = new Set([IMAGE_DIR, MAPS_DIR, SYNC_DIR]);
const workflowPathsBySender = new Map();
const WORKFLOW_FORMAT = 'navlib-workflow';
const WORKFLOW_SCHEMA_VERSION = 1;
const WORKFLOW_MAX_BYTES = 5 * 1024 * 1024;

// Workflow runs are kept, so they can be monitored and compared after the fact.
const RESULTS_DIR = path.resolve(APP_DIR, expandHome(String(settings.resultsDir || DEFAULT_SETTINGS.resultsDir)));
// Toolbar output is scratch: cleared when the app quits, unlike runs.
const SCRATCH_DIR = path.join(RESULTS_DIR, 'scratch', `session-${process.pid}`);
allowedFolders.add(RESULTS_DIR);
const MODELS_DIR = configuredFolder(APP_DIR, settings.modelsDir);
const SCENES_DIR = configuredFolder(APP_DIR, settings.scenesDir);
allowedFolders.add(MODELS_DIR);
allowedFolders.add(SCENES_DIR);
const sceneStorage = createSceneStorage({ modelsDir: MODELS_DIR, scenesDir: SCENES_DIR });

const TOOL_TIMEOUT_MS = Math.max(1000, Number(settings.toolTimeoutMs) || DEFAULT_SETTINGS.toolTimeoutMs);

mkdirSync(RESULTS_DIR, { recursive: true });

// Formats both Chromium can display and OpenCV can read. TIFF is left out: Chromium can't display it.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

// Parameters arrive from the page, so every value is checked before it becomes a CLI argument.
function numberParam(params, name, { min = -Infinity, max = Infinity, integer = false, odd = false } = {}) {
    const value = Number(params?.[name]);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)) || (odd && value % 2 === 0)) {
        throw new Error(`Invalid ${name}: ${params?.[name]}`);
    }
    return String(value);
}

// Text parameters must match one of a fixed set, never free text.
function choiceParam(params, name, allowed) {
    const value = params?.[name];
    if (!allowed.includes(value)) throw new Error(`Invalid ${name}: ${value}`);
    return value;
}

// One declaration per parameter drives both the dialog the page builds and the checks made here,
// so a tool's parameters are described in exactly one place.
//   number  - any value in [min, max]        integer - whole numbers only
//   odd     - whole, odd (OpenCV kernels)    boolean - passed to the tool as 1 or 0
//   enum    - one of `values`
const p = {
    number: (name, label, value, min, max, extra = {}) => ({ type: 'number', name, label, default: value, min, max, ...extra }),
    integer: (name, label, value, min, max, extra = {}) => ({ type: 'integer', name, label, default: value, min, max, step: 1, ...extra }),
    odd: (name, label, value, min, max, extra = {}) => ({ type: 'odd', name, label, default: value, min, max, step: 2, ...extra }),
    boolean: (name, label, value, extra = {}) => ({ type: 'boolean', name, label, default: value, ...extra }),
    enum: (name, label, value, values, extra = {}) => ({ type: 'enum', name, label, default: value, values, ...extra }),
    file: (name, label, value = '', extra = {}) => ({ type: 'file', name, label, default: value, ...extra }),
    text: (name, label, value = '', extra = {}) => ({ type: 'text', name, label, default: value, ...extra })
};

// Allow-list: toolbar action -> CLI executable, fixed leading args, and its parameters.
// Anything not listed is rejected. `args` may still be a function where the arguments are conditional.
const CLI_ACTIONS = {
    'URF': {
        exe: 'cpp-surf/build/surf_cli',
        keypoints: true,
        params: [
            p.number('hessianThreshold', 'Hessian threshold', 400, 1, 50000, { hint: 'Higher finds fewer, stronger features.' }),
            p.integer('nOctaves', 'Octaves', 4, 1, 8),
            p.integer('nOctaveLayers', 'Layers per octave', 3, 1, 8)
        ]
    },
    'SIFT': {
        exe: 'cpp-sift/build/sift_cli',
        keypoints: true,
        params: [
            p.integer('nfeatures', 'Max features (0 = all)', 0, 0, 100000),
            p.integer('nOctaveLayers', 'Layers per octave', 3, 1, 8),
            p.number('contrastThreshold', 'Contrast threshold', 0.04, 0, 1, { step: 0.01, hint: 'Higher rejects more low-contrast keypoints.' }),
            p.number('edgeThreshold', 'Edge threshold', 10, 0, 100),
            p.number('sigma', 'Sigma', 1.6, 0.1, 10, { step: 0.1 })
        ]
    },
    'ORB': {
        exe: 'cpp-orb/build/orb_cli',
        keypoints: true,
        params: [
            p.integer('nfeatures', 'Max features', 1000, 1, 100000),
            p.number('scaleFactor', 'Pyramid scale factor', 1.2, 1.01, 4, { step: 0.01 }),
            p.integer('nlevels', 'Pyramid levels', 8, 1, 16),
            p.integer('fastThreshold', 'FAST threshold', 20, 0, 255)
        ]
    },
    'FAST': {
        exe: 'cpp-fast/build/fast_cli',
        keypoints: true,
        params: [
            p.integer('threshold', 'Threshold', 20, 0, 255),
            p.boolean('nonmaxSuppression', 'Non-maximum suppression', true)
        ]
    },
    'KAZE': {
        exe: 'cpp-kaze/build/kaze_cli',
        keypoints: true,
        params: [
            p.number('threshold', 'Detector threshold', 0.001, 0, 1, { step: 0.001 }),
            p.integer('nOctaves', 'Octaves', 4, 1, 8),
            p.integer('nOctaveLayers', 'Layers per octave', 4, 1, 8)
        ]
    },
    'BRISK': {
        exe: 'cpp-brisk/build/brisk_cli',
        keypoints: true,
        params: [
            p.integer('thresh', 'Threshold', 30, 0, 255),
            p.integer('octaves', 'Octaves', 3, 0, 8),
            p.number('patternScale', 'Pattern scale', 1.0, 0.1, 10, { step: 0.1 })
        ]
    },
    'SOBEL X':  { exe: 'cpp-sobel/build/sobel_cli', fixed: ['x'],  params: [p.odd('ksize', 'Kernel size', 3, 1, 7)] },
    'SOBEL Y':  { exe: 'cpp-sobel/build/sobel_cli', fixed: ['y'],  params: [p.odd('ksize', 'Kernel size', 3, 1, 7)] },
    'SOBEL XY': { exe: 'cpp-sobel/build/sobel_cli', fixed: ['xy'], params: [p.odd('ksize', 'Kernel size', 3, 1, 7)] },
    'CORNERS': {
        exe: 'cpp-corners/build/corners_cli',
        keypoints: true,
        params: [
            p.integer('maxCorners', 'Max corners', 500, 1, 100000),
            p.number('qualityLevel', 'Quality level', 0.01, 0.000001, 1, { step: 0.001, hint: 'Fraction of the strongest corner a corner must reach.' }),
            p.number('minDistance', 'Minimum distance (px)', 10, 0, 1000),
            p.integer('blockSize', 'Block size', 3, 1, 31)
        ]
    },
    'THRESHOLD': {
        exe: 'cpp-threshold/build/threshold_cli',
        params: [
            p.integer('low', 'Low value', 0, 0, 255),
            p.integer('high', 'High value', 255, 0, 255),
            p.boolean('setBandValue', 'Set pixels inside range to a value', false),
            p.integer('bandValue', 'Band value', 255, 0, 255)
        ]
    },
    'FOURIER': { exe: 'cpp-fourier/build/fourier_cli', params: [] },
    'CANNY': {
        exe: 'cpp-canny/build/canny_cli',
        params: [
            p.integer('low', 'Low threshold', 80, 0, 255),
            p.integer('high', 'High threshold', 180, 0, 255),
            p.odd('apertureSize', 'Aperture size', 3, 3, 7),
            p.boolean('l2gradient', 'L2 gradient', false)
        ]
    },
    'HISTOGRAM': {
        exe: 'cpp-histogram/build/histogram_cli',
        params: [p.integer('bins', 'Bins', 256, 2, 256)]
    },
    'CONTOURS': {
        exe: 'cpp-contours/build/contours_cli',
        params: [
            p.integer('low', 'Canny low threshold', 80, 0, 255),
            p.integer('high', 'Canny high threshold', 180, 0, 255),
            p.integer('thickness', 'Line thickness', 2, 1, 20),
            p.boolean('externalOnly', 'Outermost contours only', true)
        ]
    },
    'MEDIAN': {
        exe: 'cpp-median/build/median_cli',
        params: [p.odd('ksize', 'Kernel size', 5, 3, 31)]
    },
    'GAUSSIAN': {
        exe: 'cpp-gaussian/build/gaussian_cli',
        params: [
            p.odd('ksize', 'Kernel size', 5, 1, 31),
            p.number('sigmaX', 'sigmaX (0 = from kernel size)', 0, 0, 100, { step: 0.1 }),
            p.number('sigmaY', 'sigmaY (0 = same as sigmaX)', 0, 0, 100, { step: 0.1 })
        ]
    },
    'STRETCH': {
        exe: 'cpp-stretch/build/stretch_cli',
        args: p2 => {
            const mode = choiceParam(p2, 'mode', ['percentile', 'minmax', 'bits']);
            if (mode === 'minmax') return [mode];
            if (mode === 'bits') return [mode, numberParam(p2, 'bits', { min: 1, max: 16, integer: true })];
            const low = numberParam(p2, 'low', { min: 0, max: 100 });
            const high = numberParam(p2, 'high', { min: 0, max: 100 });
            if (Number(low) >= Number(high)) throw new Error(`Invalid percentiles: ${low} is not below ${high}`);
            return [mode, low, high];
        }
    },
    'UNDISTORT': {
        exe: 'cpp-undistort/build/undistort_cli',
        args: p2 => [
            numberParam(p2, 'fx', { min: Number.MIN_VALUE }),
            numberParam(p2, 'fy', { min: Number.MIN_VALUE }),
            ...['cx', 'cy', 'k1', 'k2', 'p1', 'p2', 'k3'].map(name => numberParam(p2, name))
        ]
    },
    'REMAP': {
        exe: 'cpp-remap/build/remap_cli',
        params: [
            p.file('map_x', 'Map X file (or preset: identity, flip_h, flip_v, flip_hv)', 'identity', {
                hint: 'Path to XML/YAML/EXR file containing map_x (and map_y), or a preset name like identity, flip_h, flip_v, flip_hv.'
            }),
            p.file('map_y', 'Map Y file (optional if inside Map X)', '', {
                hint: 'Path to separate Map Y file if not embedded in Map X.'
            }),
            p.enum('interpolation', 'Interpolation', 'linear', ['linear', 'nearest', 'cubic', 'lanczos4']),
            p.enum('borderMode', 'Border mode', 'constant', ['constant', 'replicate', 'reflect', 'reflect101', 'wrap'])
        ]
    },
    'CONVERT': {
        exe: 'cpp-convert/build/convert_cli',
        params: [
            p.integer('width', 'Target width (px, 0 = keep)', 0, 0, 32768),
            p.integer('height', 'Target height (px, 0 = keep)', 0, 0, 32768),
            p.boolean('preserveRatio', 'Preserve aspect ratio (black borders)', true),
            p.enum('colorMode', 'Color mode', 'gray', ['gray', 'rgb', 'keep']),
            p.enum('depthMode', 'Bit depth', 'u8', ['u8', 'u16', 'keep']),
            p.enum('interpolation', 'Interpolation', 'linear', ['linear', 'nearest', 'cubic', 'area', 'lanczos4'])
        ]
    }
};

// Turns the page's values into CLI arguments, checking each against its declaration.
// A missing value falls back to the declared default rather than failing.
function buildArgs(cli, params = {}) {
    if (typeof cli.args === 'function') return cli.args(params);
    const values = (cli.params ?? []).map(spec => {
        const given = params?.[spec.name];
        const value = given === undefined || given === null || given === '' ? spec.default : given;
        switch (spec.type) {
            case 'boolean':
                if (typeof value !== 'boolean') throw new Error(`Invalid ${spec.name}: ${value}`);
                return value ? '1' : '0';
            case 'enum':
                return choiceParam({ [spec.name]: value }, spec.name, spec.values);
            case 'file':
            case 'folder':
            case 'text': {
                if (!value) return '';
                let textVal = String(value).trim();
                if (spec.type === 'file' || spec.type === 'folder') {
                    if (textVal.startsWith('~')) {
                        textVal = expandHome(textVal);
                    } else if (!path.isAbsolute(textVal)) {
                        const local = path.resolve(APP_DIR, textVal);
                        if (existsSync(local)) {
                            textVal = local;
                        }
                    }
                    if (path.isAbsolute(textVal) && existsSync(textVal)) {
                        allowedFolders.add(spec.type === 'folder' ? textVal : path.dirname(textVal));
                    }
                }
                return textVal;
            }
            default:
                return numberParam({ [spec.name]: value }, spec.name, {
                    min: spec.min,
                    max: spec.max,
                    integer: spec.type === 'integer' || spec.type === 'odd',
                    odd: spec.type === 'odd'
                });
        }
    });
    return [...(cli.fixed ?? []), ...values];
}

// The page needs the same declarations to build its dialogs; only plain data is sent.
function listActions() {
    return Object.fromEntries(Object.entries(CLI_ACTIONS).map(([action, cli]) => [action, cli.params ?? []]));
}

function isInAllowedFolder(filePath) {
    return [...allowedFolders].some(folder => {
        const relative = path.relative(folder, filePath);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
}

async function openFolder(window) {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (canceled || filePaths.length === 0) return null;

    const folder = filePaths[0];
    allowedFolders.add(folder);

    const tree = await scanImageDirectory(folder);
    return { folder, name: path.basename(folder), tree };
}

// Folder picker for workflow parameters. Choosing a folder is what grants access to it,
// so a workflow can only read or write where the user has pointed it.
async function chooseFolder(window, { create = false } = {}) {
    const properties = ['openDirectory', ...(create ? ['createDirectory'] : [])];
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties });
    if (canceled || filePaths.length === 0) return null;

    const folder = filePaths[0];
    allowedFolders.add(folder);
    return { folder, name: path.basename(folder) };
}

// Image or map picker for workflow parameters; the containing folder becomes readable.
async function chooseImageFile(window, options = {}) {
    const filters = options?.filters ?? [
        { name: 'Supported Files (*.xml, *.yml, *.yaml, *.exr, images)', extensions: ['xml', 'yml', 'yaml', 'exr', 'tiff', 'tif', ...[...IMAGE_EXTENSIONS].map(ext => ext.slice(1))] },
        { name: 'Calibration / Map Files (*.xml, *.yml, *.yaml)', extensions: ['xml', 'yml', 'yaml'] },
        { name: 'Images', extensions: [...IMAGE_EXTENSIONS].map(ext => ext.slice(1)) },
        { name: 'All Files', extensions: ['*'] }
    ];
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters
    });
    if (canceled || filePaths.length === 0) return null;

    const file = filePaths[0];
    allowedFolders.add(path.dirname(file));
    return { file, name: path.basename(file) };
}

async function scanImageDirectory(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            const nested = await scanImageDirectory(entryPath);
            if (nested.length > 0) {
                children.push({ type: 'folder', name: entry.name, path: entryPath, children: nested });
            }
            continue;
        }

        if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            children.push({
                type: 'image',
                name: entry.name,
                path: entryPath,
                url: pathToFileURL(entryPath).href
            });
        }
    }

    return children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
}

async function scanResultsDirectory(directory, depth = 0) {
    const entries = await readdir(directory, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = await scanResultsDirectory(entryPath, depth + 1);
            if (depth < 2 || nested.length > 0) {
                children.push({
                    type: 'folder',
                    name: entry.name,
                    path: entryPath,
                    children: nested,
                    deleteKind: depth === 0 ? 'workflow' : depth === 1 ? 'run' : null
                });
            }
        } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            children.push({
                type: 'image',
                name: entry.name,
                path: entryPath,
                url: pathToFileURL(entryPath).href
            });
        }
    }

    return children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
}

// --- Workflow runs ----------------------------------------------------------
//
// Every intermediate is a real file, so a run can be inspected, re-opened and compared afterwards.
// Layout, under the resultsDir from app.json:
//   <resultsDir>/runs/<workflow>/<run>/frames/NNNN/SS_<node>__<port>.<ext>
// NNNN is the frame, SS is the step's place in execution order, so a frame folder reads top to
// bottom as the graph ran. The producing node and port name the file, because an edge is identified
// by where the data came from, not where it goes.

const RUNS_DIR = path.join(RESULTS_DIR, 'runs');

// File extension per port type; anything not listed is treated as an image.
const PORT_FILE_TYPES = { image: 'png', disparity: 'png', text: 'json', keypoints: 'json', matches: 'json', pointcloud: 'ply' };

function slug(text, fallback = 'item') {
    const cleaned = String(text ?? '')
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);
    // Leading dots are stripped above, so "." and ".." can never survive as a path segment.
    return cleaned || fallback;
}

// Depth-first topological order. Returns null if the graph has a cycle.
function topologicalOrder(nodes, edges) {
    const incoming = new Map(nodes.map(node => [node.id, []]));
    for (const edge of edges) {
        if (incoming.has(edge.to.nodeId)) incoming.get(edge.to.nodeId).push(edge.from.nodeId);
    }
    const order = [];
    const state = new Map(); // undefined = new, 1 = visiting, 2 = done
    const visit = nodeId => {
        if (state.get(nodeId) === 2) return true;
        if (state.get(nodeId) === 1) return false;
        state.set(nodeId, 1);
        for (const from of incoming.get(nodeId) ?? []) {
            if (!visit(from)) return false;
        }
        state.set(nodeId, 2);
        order.push(nodeId);
        return true;
    };

    for (const node of nodes) if (!visit(node.id)) return null;
    return order;
}

// Where each step's outputs live for one frame. Kept separate from the plan so the same
// naming is used whether a path is being previewed or written.
function frameArtifacts(steps, runDir, frame) {
    const frameDir = path.join(runDir, 'frames', String(frame).padStart(4, '0'));
    return new Map(steps.map(step => [
        step.nodeId,
        Object.fromEntries(step.outputPorts.map(port => [
            port.name,
            path.join(frameDir, `${String(step.order).padStart(2, '0')}_${slug(step.name, 'node')}__${slug(port.name, 'out')}.${PORT_FILE_TYPES[port.type] ?? 'png'}`)
        ]))
    ]));
}

// Works out execution order and the file each output will be written to, without running anything.
// Returns the same shape whether or not the graph is runnable, so the page can show the problems.
async function prepareWorkflowRun({ name, graph } = {}) {
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    const problems = [];

    if (nodes.length === 0) problems.push('The workflow is empty.');

    const order = topologicalOrder(nodes, edges);
    if (order === null) problems.push('The graph contains a loop.');

    // An input with no edge has nothing to read, unless the node is a source.
    const filled = new Set(edges.map(edge => `${edge.to.nodeId}:${edge.to.port}`));
    for (const node of nodes) {
        for (const port of node.inputs ?? []) {
            if (!filled.has(`${node.id}:${port.name}`)) {
                problems.push(`${node.name} has nothing connected to its "${port.name}" input.`);
            }
        }
    }

    const workflowSlug = slug(name, 'workflow');
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const runDir = path.join(RUNS_DIR, workflowSlug, runId);

    const byId = new Map(nodes.map(node => [node.id, node]));
    const steps = (order ?? nodes.map(node => node.id)).map((nodeId, index) => {
        const node = byId.get(nodeId);
        return {
            nodeId,
            name: node.name,
            elementId: node.elementId,
            order: index + 1,
            params: node.params ?? {},
            outputPorts: (node.outputs ?? []).map(port => ({ name: port.name, type: port.type })),
            inputPorts: (node.inputs ?? []).map(port => ({ name: port.name, type: port.type })),
            // Where each input comes from: the producing node and its port.
            sources: Object.fromEntries((node.inputs ?? []).map(port => {
                const edge = edges.find(e => e.to.nodeId === nodeId && e.to.port === port.name);
                return [port.name, edge ? { nodeId: edge.from.nodeId, port: edge.from.port } : null];
            }))
        };
    });

    // Frame 1's paths, so the plan can be shown before anything runs.
    const preview = frameArtifacts(steps, runDir, 1);
    for (const step of steps) {
        step.outputs = preview.get(step.nodeId);
        step.inputs = Object.fromEntries(Object.entries(step.sources).map(([port, source]) =>
            [port, source ? preview.get(source.nodeId)?.[source.port] ?? null : null]));
    }

    const runnable = problems.length === 0;
    if (runnable) {
        await mkdir(runDir, { recursive: true });
        allowedFolders.add(runDir);
    }

    return { runnable, problems, workflow: workflowSlug, runId, runDir, steps };
}

// --- Running a workflow -----------------------------------------------------

// Element definitions are read here rather than taken from the page, so the executable a step runs
// is always one of ours: the page can choose which element, never what it runs.
async function loadElements() {
    const entries = await readdir(SPEC_DIRS.elements, { withFileTypes: true });
    const elements = new Map();
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
        try {
            const spec = JSON.parse(await readFile(path.join(SPEC_DIRS.elements, entry.name), 'utf8'));
            if (spec?.id) elements.set(spec.id, spec);
        } catch {
            // A malformed element file just means that element cannot run.
        }
    }
    return elements;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const WORKFLOW_PORT_TYPES = { disparity: 'image', keypoints: 'text', matches: 'text' };

function isWorkflowPortAssignable(fromType, toType) {
    if (fromType === 'any' || toType === 'any') return true;
    for (let type = fromType; type; type = WORKFLOW_PORT_TYPES[type]) {
        if (type === toType) return true;
    }
    return false;
}

function workflowAccessTarget(value, type) {
    const resolved = path.resolve(APP_DIR, expandHome(String(value)));
    if (type === 'folder') return path.join(resolved, 'workflow-access-check');
    return resolved;
}

async function normalizeWorkflowGraph(rawGraph) {
    if (!isRecord(rawGraph) || !Array.isArray(rawGraph.nodes) || !Array.isArray(rawGraph.edges)) {
        throw new Error('Workflow graph must contain node and edge arrays.');
    }
    if (rawGraph.nodes.length > 1000 || rawGraph.edges.length > 10000) {
        throw new Error('Workflow is too large to open.');
    }

    const elements = await loadElements();
    const nodeIds = new Set();
    const nodeById = new Map();
    const warnings = [];

    const nodes = rawGraph.nodes.map(rawNode => {
        if (!isRecord(rawNode) || typeof rawNode.id !== 'string' || !rawNode.id || rawNode.id.length > 128) {
            throw new Error('Workflow contains a node with an invalid ID.');
        }
        if (nodeIds.has(rawNode.id)) throw new Error(`Workflow contains duplicate node ID "${rawNode.id}".`);
        nodeIds.add(rawNode.id);

        const element = elements.get(rawNode.elementId);
        if (!element) throw new Error(`Workflow uses an unknown element "${rawNode.elementId}".`);
        if (!isRecord(rawNode.params ?? {})) throw new Error(`Node "${rawNode.name ?? element.name}" has invalid parameters.`);
        if (!Number.isFinite(rawNode.x) || !Number.isFinite(rawNode.y) || rawNode.x < 0 || rawNode.y < 0) {
            throw new Error(`Node "${rawNode.name ?? element.name}" has an invalid position.`);
        }

        const params = {};
        for (const [name, paramSpec] of Object.entries(element.params ?? {})) {
            let value = Object.hasOwn(rawNode.params ?? {}, name)
                ? rawNode.params[name]
                : (paramSpec.default ?? null);
            const invalidValue = () => new Error(`Node "${rawNode.name ?? element.name}" has an invalid value for "${name}".`);
            if (value !== null) {
                if (['folder', 'file', 'path', 'camera', 'text', 'string', 'code'].includes(paramSpec.type)) {
                    if (typeof value !== 'string') throw invalidValue();
                } else if (paramSpec.type === 'boolean') {
                    if (typeof value !== 'boolean') throw invalidValue();
                } else if (paramSpec.type === 'enum') {
                    const options = paramSpec.values ?? paramSpec.options ?? [];
                    if (!options.some(option => (option?.value ?? option) === value)) throw invalidValue();
                } else {
                    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidValue();
                    if (paramSpec.min !== undefined && value < paramSpec.min) throw invalidValue();
                    if (paramSpec.max !== undefined && value > paramSpec.max) throw invalidValue();
                    if (paramSpec.type === 'integer' && !Number.isInteger(value)) throw invalidValue();
                    if (paramSpec.type === 'odd' && (!Number.isInteger(value) || value % 2 === 0)) throw invalidValue();
                }
            }

            const looksLikePath = paramSpec.type === 'folder' || paramSpec.type === 'path' ||
                (paramSpec.type === 'file' && typeof value === 'string' &&
                    (path.isAbsolute(value) || value.includes('/') || Boolean(path.extname(value))));
            if (looksLikePath && value && !isInAllowedFolder(workflowAccessTarget(value, paramSpec.type))) {
                warnings.push(`${rawNode.name ?? element.name}: choose the ${paramSpec.label ?? name} location again before running; loading a workflow does not grant access to saved paths.`);
            }
            params[name] = value;
        }

        const node = {
            id: rawNode.id,
            elementId: element.id,
            name: typeof rawNode.name === 'string' && rawNode.name.trim() ? rawNode.name : element.name,
            kind: element.kind,
            icon: element.icon,
            inputs: element.inputs ?? [],
            outputs: element.outputs ?? [],
            telemetry: element.telemetry ?? [],
            params,
            x: Math.round(rawNode.x),
            y: Math.round(rawNode.y)
        };
        nodeById.set(node.id, node);
        return node;
    });

    const edgeIds = new Set();
    const edgeKeys = new Set();
    const occupiedInputs = new Set();
    const edges = rawGraph.edges.map(rawEdge => {
        if (!isRecord(rawEdge) || typeof rawEdge.id !== 'string' || !rawEdge.id ||
            !isRecord(rawEdge.from) || !isRecord(rawEdge.to)) {
            throw new Error('Workflow contains an invalid connection.');
        }
        if (edgeIds.has(rawEdge.id)) throw new Error(`Workflow contains duplicate connection ID "${rawEdge.id}".`);
        edgeIds.add(rawEdge.id);

        const fromNode = nodeById.get(rawEdge.from.nodeId);
        const toNode = nodeById.get(rawEdge.to.nodeId);
        const direction = rawEdge.from.direction === 'telemetry' ? 'telemetry' : 'output';
        const fromPorts = direction === 'telemetry' ? fromNode?.telemetry : fromNode?.outputs;
        const fromPort = fromPorts?.find(port => port.name === rawEdge.from.port);
        const toPort = toNode?.inputs.find(port => port.name === rawEdge.to.port);
        if (!fromNode || !toNode || !fromPort || !toPort) {
            throw new Error(`Workflow connection "${rawEdge.id}" references a missing node or port.`);
        }
        if (!isWorkflowPortAssignable(fromPort.type, toPort.type)) {
            throw new Error(`Workflow connection "${rawEdge.id}" has incompatible port types.`);
        }
        const connectionKey = `${fromNode.id}:${direction}:${fromPort.name}:${toNode.id}:${toPort.name}`;
        if (edgeKeys.has(connectionKey)) throw new Error(`Workflow contains a duplicate connection to "${toNode.name}.${toPort.name}".`);
        edgeKeys.add(connectionKey);
        const inputKey = `${toNode.id}:${toPort.name}`;
        if (toNode.kind !== 'sink' && occupiedInputs.has(inputKey)) {
            throw new Error(`Workflow connects multiple sources to "${toNode.name}.${toPort.name}".`);
        }
        occupiedInputs.add(inputKey);
        return {
            id: rawEdge.id,
            from: { nodeId: fromNode.id, port: fromPort.name, direction },
            to: { nodeId: toNode.id, port: toPort.name }
        };
    });

    if (topologicalOrder(nodes, edges) === null) throw new Error('Workflow graph contains a cycle.');

    return { graph: { nodes, edges }, warnings };
}

async function workflowDocumentForSave(input) {
    if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) {
        throw new Error('Workflow must have a name.');
    }
    const { graph } = await normalizeWorkflowGraph(input.graph);
    return {
        format: WORKFLOW_FORMAT,
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        name: input.name.trim(),
        graph: {
            nodes: graph.nodes.map(({ id, elementId, name, params, x, y }) => ({ id, elementId, name, params, x, y })),
            edges: graph.edges
        }
    };
}

function registerWorkflowPath(senderId, filePath) {
    let paths = workflowPathsBySender.get(senderId);
    if (!paths) {
        paths = new Set();
        workflowPathsBySender.set(senderId, paths);
    }
    paths.add(path.resolve(filePath));
}

async function writeWorkflowFile(filePath, input) {
    const document = await workflowDocumentForSave(input);
    const serialized = JSON.stringify(document, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > WORKFLOW_MAX_BYTES) {
        throw new Error('Workflow file exceeds the 5 MB limit.');
    }
    const target = path.resolve(filePath);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
        await writeFile(temporary, `${serialized}\n`, { flag: 'wx' });
        await rename(temporary, target);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

async function openWorkflowFile(window, senderId) {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        filters: [{ name: 'Workflow JSON', extensions: ['json'] }]
    });
    if (canceled || filePaths.length === 0) return null;

    const filePath = path.resolve(filePaths[0]);
    const info = await stat(filePath);
    if (info.size > WORKFLOW_MAX_BYTES) throw new Error('Workflow file exceeds the 5 MB limit.');
    const document = JSON.parse(await readFile(filePath, 'utf8'));
    if (document?.format !== WORKFLOW_FORMAT || document?.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
        throw new Error('Unsupported workflow file format or schema version.');
    }
    if (typeof document.name !== 'string' || !document.name.trim()) throw new Error('Workflow file has no name.');

    const { graph, warnings } = await normalizeWorkflowGraph(document.graph);
    registerWorkflowPath(senderId, filePath);
    return { filePath, name: document.name, graph, warnings };
}

async function saveWorkflowAs(window, senderId, input) {
    const document = await workflowDocumentForSave(input);
    const workflowDir = path.join(RESULTS_DIR, 'workflows');
    await mkdir(workflowDir, { recursive: true });
    const { canceled, filePath: chosenPath } = await dialog.showSaveDialog(window, {
        title: 'Save Workflow',
        defaultPath: path.join(workflowDir, `${slug(document.name, 'workflow')}.workflow.json`),
        filters: [{ name: 'Workflow JSON', extensions: ['json'] }]
    });
    if (canceled || !chosenPath) return null;

    const filePath = path.extname(chosenPath).toLowerCase() === '.json' ? chosenPath : `${chosenPath}.json`;
    await writeWorkflowFile(filePath, document);
    registerWorkflowPath(senderId, filePath);
    return { filePath: path.resolve(filePath) };
}

async function saveWorkflow(senderId, filePath, input) {
    const resolved = path.resolve(String(filePath ?? ''));
    if (!workflowPathsBySender.get(senderId)?.has(resolved)) {
        throw new Error('Save As is required before saving to this workflow path.');
    }
    await writeWorkflowFile(resolved, input);
    return { filePath: resolved };
}

async function openWorkflowArtifact(filePath, type) {
    const resolved = path.resolve(String(filePath ?? ''));
    if (!isInAllowedFolder(resolved)) throw new Error('Artifact path is not authorized.');
    if (type === 'text') {
        if ((await stat(resolved)).size > 5 * 1024 * 1024) throw new Error('Text preview exceeds the 5 MB limit.');
        return { kind: 'text', path: resolved, content: await readFile(resolved, 'utf8'), name: path.basename(resolved) };
    }
    const extension = path.extname(resolved).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
        return { kind: 'image', path: resolved, url: pathToFileURL(resolved).href, name: path.basename(resolved) };
    }
    if (extension === '.json') {
        const parsed = JSON.parse(await readFile(resolved, 'utf8'));
        return { kind: 'json', path: resolved, content: `${JSON.stringify(parsed, null, 2)}\n`, name: path.basename(resolved) };
    }
    throw new Error(`Unsupported artifact type: ${extension || 'unknown'}`);
}

function resolveCli(relative) {
    const resolved = path.resolve(CLI_DIR, relative);
    const inside = path.relative(CLI_DIR, resolved);
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`Tool path not allowed: ${relative}`);
    return resolved;
}

const IMAGE_NAME_ORDER = (a, b) => a.localeCompare(b, undefined, { numeric: true });

async function listImages(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map(entry => entry.name)
        .sort(IMAGE_NAME_ORDER)
        .map(name => path.join(directory, name));
}

// The frames a run will emit come from its source nodes.
async function resolveSourceFrames(steps, elements, runDir, log) {
    const sources = steps.filter(step => elements.get(step.elementId)?.kind === 'source');
    if (sources.length === 0) throw new Error('The workflow has no source element.');

    const resolved = new Map();
    let frameCount = null;

    for (const step of sources) {
        log?.({ label: step.name, stream: 'system', text: 'Preparing source\n' });
        const element = elements.get(step.elementId);
        const builtin = element.exec?.builtin;

        if (builtin === 'dir_source') {
            const dir = step.params.dir;
            if (!dir) throw new Error(`${step.name} has no source folder set.`);
            if (!isInAllowedFolder(path.join(dir, 'probe'))) throw new Error(`Source folder not allowed: ${dir}`);
            const files = await listImages(dir);
            if (files.length === 0) throw new Error(`${step.name}: no images in ${dir}`);
            resolved.set(step.nodeId, { port: step.outputPorts[0]?.name ?? 'image', files });
            frameCount = frameCount === null ? files.length : Math.min(frameCount, files.length);
        } else if (builtin === 'single_image') {
            const file = step.params.image;
            if (!file) throw new Error(`${step.name} has no image set.`);
            if (!isInAllowedFolder(file)) throw new Error(`Image not allowed: ${file}`);
            resolved.set(step.nodeId, { port: step.outputPorts[0]?.name ?? 'image', files: [file], repeat: true });
        } else if (builtin === 'synthetic_scene_source') {
            const { files } = await renderSyntheticScene({
                ...step.params,
                params_file: step.params.params_file ? expandHome(step.params.params_file) : undefined
            }, {
                appDir: APP_DIR, modelsDir: MODELS_DIR, runDir, isAllowed: isInAllowedFolder,
                render: (exe, args, options) => executeCli(exe, args, options, log, step.name),
                blender: existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
                    ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender'
            });
            resolved.set(step.nodeId, { port: 'image', files, repeat: files.length === 1 });
            if (files.length > 1) frameCount = frameCount === null ? files.length : Math.min(frameCount, files.length);
        } else if (builtin === 'physical_camera_source') {
            const cliExecutable = resolveCli('cpp-usb-camera/build/usb_camera_cli');
            const vscodeExecutable = path.join(APP_DIR, 'build', 'cpp-usb-camera', 'usb_camera_cli');
            const { batchDir, files } = await capturePhysicalCamera(step.params ?? {}, {
                executable: existsSync(cliExecutable) ? cliExecutable : vscodeExecutable,
                appDir: APP_DIR,
                timeout: TOOL_TIMEOUT_MS,
                capture: (exe, args, options) => executeCli(exe, args, options, log, step.name)
            });
            allowedFolders.add(batchDir);
            resolved.set(step.nodeId, { port: step.outputPorts[0]?.name ?? 'image', files });
            frameCount = frameCount === null ? files.length : Math.min(frameCount, files.length);
        } else if (builtin === 'sync_camera_source' || builtin === 'sync_source') {
            const sceneFolder = step.params.scene
                ? path.resolve(APP_DIR, expandHome(String(step.params.scene)))
                : path.join(APP_DIR, 'SynC', 'scenes', 'ingress');

            allowedFolders.add(sceneFolder);

            const leftDir = path.join(sceneFolder, 'left');
            const rightDir = path.join(sceneFolder, 'right');
            allowedFolders.add(leftDir);
            allowedFolders.add(rightDir);

            let filesL = existsSync(leftDir) ? await listImages(leftDir) : [];
            let filesR = existsSync(rightDir) ? await listImages(rightDir) : [];

            const shouldRegenerate = Boolean(step.params.regenerate) || filesL.length === 0 || filesR.length === 0;

            if (shouldRegenerate) {
                const scriptPath = path.join(sceneFolder, 'build_ingress_scene.py');
                if (existsSync(scriptPath)) {
                    const blenderBin = existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
                        ? '/Applications/Blender.app/Contents/MacOS/Blender'
                        : 'blender';

                    const cliArgs = ['--background', '--python-exit-code', '1', '--python', scriptPath, '--'];
                    if (step.params.start != null) cliArgs.push('--start', String(step.params.start));
                    if (step.params.stop != null) cliArgs.push('--stop', String(step.params.stop));
                    if (step.params.increment != null) cliArgs.push('--increment', String(step.params.increment));
                    if (step.params.target_model) cliArgs.push('--target-model', String(step.params.target_model));
                    if (step.params.camera) cliArgs.push('--camera-spec', path.join('camera_spec', path.basename(String(step.params.camera))));
                    if (step.params.sunAzimuth != null) cliArgs.push('--azimuth', String(step.params.sunAzimuth));
                    if (step.params.sunElevation != null) cliArgs.push('--elevation', String(step.params.sunElevation));

                    await executeCli(blenderBin, cliArgs, { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, log, step.name);
                    filesL = await listImages(leftDir);
                    filesR = await listImages(rightDir);
                }
            }

            if (filesL.length === 0 || filesR.length === 0) {
                throw new Error(`${step.name}: no images found in ${leftDir} or ${rightDir}`);
            }

            resolved.set(step.nodeId, {
                ports: {
                    imageL: filesL,
                    imageR: filesR,
                    image: filesL
                }
            });
            const count = Math.min(filesL.length, filesR.length);
            frameCount = frameCount === null ? count : Math.min(frameCount, count);
        } else {
            throw new Error(`${step.name} cannot provide frames yet (${builtin ?? 'no exec'}).`);
        }
    }

    // A single image on its own is one frame; alongside a directory it repeats for every frame.
    return { sources: resolved, frameCount: frameCount ?? 1 };
}

// Runs one frame: every step in order, each reading files the previous steps wrote.
async function runFrame({ steps, elements, sourceFrames, runDir, frame, onStepStart, log }) {
    const artifacts = frameArtifacts(steps, runDir, frame);
    await mkdir(path.dirname(Object.values(artifacts.get(steps[0].nodeId))[0]
        ?? path.join(runDir, 'frames', String(frame).padStart(4, '0'), 'x')), { recursive: true });

    const produced = new Map();
    const stepResults = [];

    for (const step of steps) {
        onStepStart?.(step.nodeId, step.name);
        const element = elements.get(step.elementId);
        if (!element) throw new Error(`${step.name}: no element definition for "${step.elementId}".`);

        const outputs = artifacts.get(step.nodeId);
        const inputs = Object.fromEntries(Object.entries(step.sources).map(([port, source]) =>
            [port, source ? produced.get(source.nodeId)?.[source.port] ?? null : null]));

        const started = performance.now();
        const source = sourceFrames.get(step.nodeId);

        if (source) {
            // Source nodes do not run a tool; they hand the frame's file to the next step.
            if (source.ports) {
                const portMap = {};
                for (const [pName, pFiles] of Object.entries(source.ports)) {
                    portMap[pName] = source.repeat ? pFiles[0] : pFiles[(frame - 1) % pFiles.length];
                }
                produced.set(step.nodeId, portMap);
                stepResults.push({
                    nodeId: step.nodeId,
                    name: step.name,
                    order: step.order,
                    ms: 0,
                    output: Object.values(portMap)[0],
                    artifacts: step.outputPorts.filter(port => portMap[port.name]).map(port => ({
                        port: port.name,
                        type: port.type,
                        path: portMap[port.name]
                    }))
                });
            } else {
                const file = source.repeat ? source.files[0] : source.files[(frame - 1) % source.files.length];
                produced.set(step.nodeId, { [source.port]: file });
                stepResults.push({
                    nodeId: step.nodeId,
                    name: step.name,
                    order: step.order,
                    ms: 0,
                    output: file,
                    artifacts: step.outputPorts.filter(port => port.name === source.port).map(port => ({
                        port: port.name,
                        type: port.type,
                        path: file
                    }))
                });
            }
            continue;
        }

        const builtin = element.exec?.builtin;
        if (builtin === 'ui_view' || builtin === 'ui_view_text') {
            const result = uiViewResult(step, inputs, builtin === 'ui_view_text' ? 'text' : 'image');
            if (!isInAllowedFolder(result.output)) throw new Error('UIView image path is not authorized.');
            if (builtin === 'ui_view' && !IMAGE_EXTENSIONS.has(path.extname(result.output).toLowerCase())) {
                throw new Error(`${step.name} requires an image file.`);
            }
            if (!(await stat(result.output)).isFile()) throw new Error(`${step.name} requires a regular file.`);
            produced.set(step.nodeId, {});
            stepResults.push(result);
            continue;
        }

        if (builtin === 'passthrough') {
            const incoming = Object.values(inputs)[0];
            if (!incoming) throw new Error(`${step.name} has no input to pass on.`);
            const portMap = Object.fromEntries(step.outputPorts.map(port => [port.name, incoming]));
            produced.set(step.nodeId, portMap);
            stepResults.push({
                nodeId: step.nodeId,
                name: step.name,
                order: step.order,
                ms: 0,
                output: incoming,
                artifacts: step.outputPorts.map(port => ({ port: port.name, type: port.type, path: portMap[port.name] }))
            });
            continue;
        }

        if (builtin === 'save_to_dir' || builtin === 'save_text_to_dir' || builtin === 'save_pointcloud_to_dir') {
            const incoming = Object.values(inputs)[0];
            if (!incoming) throw new Error(`${step.name} has nothing to save.`);
            const dir = step.params.dir;
            if (!dir) throw new Error(`${step.name} has no destination folder set.`);
            if (!isInAllowedFolder(path.join(dir, 'probe'))) throw new Error(`Destination folder not allowed: ${dir}`);
            const extension = builtin === 'save_to_dir'
                ? slug(step.params.fmt || 'png', 'png')
                : path.extname(incoming).slice(1) || (builtin === 'save_pointcloud_to_dir' ? 'ply' : 'txt');
            const target = path.join(dir, `${slug(step.name, 'out')}_${String(frame).padStart(4, '0')}.${extension}`);
            await copyFile(incoming, target);
            produced.set(step.nodeId, {});
            stepResults.push({ name: step.name, order: step.order, ms: Math.round(performance.now() - started), output: target });
            continue;
        }

        if (builtin === 'process_text') {
            if (!inputs.text || !isInAllowedFolder(inputs.text)) throw new Error(`${step.name}: JSON input path is missing or not authorized.`);
            await processTextFile({
                input: inputs.text, output: outputs.text, code: step.params.code,
                log, label: `${step.name} · frame ${frame}`
            });
        } else {
            if (!element.exec?.cli) throw new Error(`${step.name} cannot run yet (${builtin ?? 'no exec'}).`);
            const args = renderArgs(element.exec.args ?? [], { inputs, outputs, params: step.params, frameIndex: frame - 1 });
            await executeCli(resolveCli(element.exec.cli), args, { timeout: TOOL_TIMEOUT_MS }, log, `${step.name} · frame ${frame}`);
        }

        produced.set(step.nodeId, outputs);
        stepResults.push({
            nodeId: step.nodeId,
            name: step.name,
            order: step.order,
            ms: Math.round(performance.now() - started),
            output: Object.values(outputs)[0] ?? null,
            artifacts: step.outputPorts.filter(port => outputs[port.name]).map(port => ({
                port: port.name,
                type: port.type,
                path: outputs[port.name]
            }))
        });
    }

    return stepResults;
}

// One run at a time; the page can stop it.
let activeRun = null;

async function runWorkflow(sender, { name, graph, maxFrames, logTabId } = {}) {
    if (activeRun) throw new Error('A workflow is already running.');

    const plan = await prepareWorkflowRun({ name, graph });
    if (!plan.runnable) throw new Error(plan.problems.join(' '));

    const elements = await loadElements();
    const log = entry => { if (!sender.isDestroyed()) sender.send('console:log', { tabId: logTabId, ...entry }); };
    const { sources, frameCount } = await resolveSourceFrames(plan.steps, elements, plan.runDir, log);

    // Frame rate comes from the directory source; it is what stands in for a camera.
    const fpsStep = plan.steps.find(step => sources.get(step.nodeId) && step.params.fps);
    const fps = Math.min(240, Math.max(0.1, Number(fpsStep?.params.fps) || 30));
    const interval = 1000 / fps;
    const looping = plan.steps.some(step => sources.get(step.nodeId) && step.params.loop);
    const limit = Math.max(1, Math.min(Number(maxFrames) || frameCount, looping ? Number(maxFrames) || frameCount : frameCount));

    const run = { stopped: false, frame: 0, late: 0, runDir: plan.runDir, lastFrame: null };
    activeRun = run;
    const post = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload); };
    post('workflow:started', { runDir: plan.runDir, frames: limit, fps, steps: plan.steps.map(s => s.name) });

    try {
        while (!run.stopped && run.frame < limit) {
            const frame = run.frame + 1;
            const started = performance.now();
            const stepResults = await runFrame({
                steps: plan.steps,
                elements,
                sourceFrames: sources,
                runDir: plan.runDir,
                frame,
                log,
                onStepStart: (nodeId, stepName) => {
                    log({ label: stepName, stream: 'system', text: `Executing frame ${frame}\n` });
                    post('workflow:step', { frame, nodeId, stepName });
                }
            });
            const elapsed = performance.now() - started;
            run.frame = frame;
            if (elapsed > interval) run.late += 1;

            post('workflow:step', { frame, nodeId: null });
            run.lastFrame = {
                frame, frames: limit, ms: Math.round(elapsed), late: elapsed > interval, steps: stepResults
            };
            post('workflow:frame', run.lastFrame);

            // Wait for the rest of the frame's time slot, rather than starting the next frame on a
            // timer that could overlap this one.
            const remaining = interval - elapsed;
            if (!run.stopped && remaining > 0 && frame < limit) {
                await new Promise(resolve => setTimeout(resolve, remaining));
            }
        }
        const summary = {
            runDir: plan.runDir, frames: run.frame, late: run.late,
            stopped: run.stopped, lastFrame: run.lastFrame
        };
        post('workflow:finished', summary);
        return summary;
    } catch (err) {
        post('workflow:step', { frame: run.frame + 1, nodeId: null });
        post('workflow:failed', { runDir: plan.runDir, frame: run.frame + 1, message: err.message });
        throw new Error(`Frame ${run.frame + 1}: ${err.message}`);
    } finally {
        activeRun = null;
    }
}

function stopWorkflow() {
    if (activeRun) activeRun.stopped = true;
    return { stopping: Boolean(activeRun) };
}

// Browsing the results folder from app.json. Its images are already allowed, so they open like any other.
async function listResults() {
    await mkdir(RUNS_DIR, { recursive: true });
    return { folder: RUNS_DIR, name: path.basename(RESULTS_DIR), tree: await scanResultsDirectory(RUNS_DIR) };
}

async function deleteResult(targetPath) {
    await mkdir(RUNS_DIR, { recursive: true });
    const requestedPath = path.resolve(String(targetPath ?? ''));
    const relativeRequest = path.relative(RUNS_DIR, requestedPath);
    const requestParts = relativeRequest.split(path.sep).filter(Boolean);
    if (!relativeRequest || relativeRequest.startsWith('..') || path.isAbsolute(relativeRequest) || requestParts.length > 2) {
        throw new Error('Only a workflow or run folder inside results/runs can be deleted.');
    }

    const info = await lstat(requestedPath);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('The selected result is not a deletable folder.');

    const runsRoot = await realpath(RUNS_DIR);
    const resolvedTarget = await realpath(requestedPath);
    const relativeTarget = path.relative(runsRoot, resolvedTarget);
    const targetParts = relativeTarget.split(path.sep).filter(Boolean);
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget) || targetParts.length < 1 || targetParts.length > 2) {
        throw new Error('The selected result resolves outside the runs folder.');
    }

    if (activeRun) {
        const activeRelative = path.relative(resolvedTarget, path.resolve(activeRun.runDir));
        if (activeRelative === '' || (!activeRelative.startsWith('..') && !path.isAbsolute(activeRelative))) {
            throw new Error('Cannot delete a workflow or run while it is running.');
        }
    }

    await rm(resolvedTarget, { recursive: true, force: false });
    return await listResults();
}

// One JSON file per spec. A file that doesn't parse is returned with an error instead of hiding the rest.
async function listSpecs(kind) {    const dir = SPEC_DIRS[kind];
    if (!dir) throw new Error(`Unknown spec kind: ${kind}`);

    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
        .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
        .map(entry => entry.name)
        .sort();

    return Promise.all(files.map(async file => {
        try {
            return { file, spec: JSON.parse(await readFile(path.join(dir, file), 'utf8')) };
        } catch (err) {
            return { file, error: err.message };
        }
    }));
}

async function readSpec(kind, file) {
    const dir = SPEC_DIRS[kind];
    if (!dir) throw new Error(`Unknown spec kind: ${kind}`);
    const safeFile = path.basename(file);
    if (!safeFile.toLowerCase().endsWith('.json')) throw new Error(`Invalid spec filename: ${file}`);
    const filePath = path.join(dir, safeFile);
    const content = await readFile(filePath, 'utf8');
    return { path: filePath, file: safeFile, content };
}

async function saveSpec(kind, file, content) {
    const dir = SPEC_DIRS[kind];
    if (!dir) throw new Error(`Unknown spec kind: ${kind}`);
    const safeFile = path.basename(file);
    if (!safeFile.toLowerCase().endsWith('.json')) throw new Error(`Invalid spec filename: ${file}`);
    try {
        JSON.parse(content);
    } catch (err) {
        throw new Error(`Invalid JSON: ${err.message}`);
    }
    const filePath = path.join(dir, safeFile);
    await writeFile(filePath, content, 'utf8');
    return { success: true, path: filePath, file: safeFile };
}

async function runVisionCli(action, imagePath, params = {}, log = () => {}) {
    const cli = CLI_ACTIONS[action];
    if (!cli) throw new Error(`Unknown action: ${action}`);

    // Only images inside allowed folders may be processed -- blocks paths like "../../etc/passwd".
    const inputPath = path.resolve(APP_DIR, imagePath);
    if (!isInAllowedFolder(inputPath)) {
        // Truncated: a data: URL passed by mistake would otherwise flood the log.
        const shown = imagePath.length > 120 ? `${imagePath.slice(0, 120)}…` : imagePath;
        throw new Error(`Image path not allowed: ${shown}`);
    }

    await mkdir(SCRATCH_DIR, { recursive: true });
    const outputPath = path.join(SCRATCH_DIR, `${action.replace(/\s+/g, '_')}-${randomUUID()}.png`);

    const started = performance.now();
    // execFile (no shell) so the path is passed as a plain argument, never interpreted as a command.
    const keypointsPath = cli.keypoints ? outputPath.replace(/\.png$/, '.keypoints.json') : null;
    const actionArgs = [...(keypointsPath ? [keypointsPath] : []), ...buildArgs(cli, params)];
    await executeCli(path.join(CLI_DIR, cli.exe), [inputPath, outputPath, ...actionArgs], { timeout: TOOL_TIMEOUT_MS }, log, action);
    const timingMs = Math.round(performance.now() - started);

    const bytes = await readFile(outputPath);

    return { image: `data:image/png;base64,${bytes.toString('base64')}`, path: outputPath, timingMs, ...(keypointsPath ? { keypointsPath } : {}) };
}

// Pixel data for each open surface window, keyed by webContents id and handed over once the page asks.
const surfacePayloads = new Map();
// Surface windows opened from each page window, so they can be closed with it.
const surfaceWindows = new Map();

async function openSurfaceWindow(parent, imagePath) {
    const resolved = path.resolve(APP_DIR, imagePath);
    if (!isInAllowedFolder(resolved)) {
        const shown = imagePath.length > 120 ? `${imagePath.slice(0, 120)}…` : imagePath;
        throw new Error(`Image path not allowed: ${shown}`);
    }

    const bytes = await readFile(resolved);
    const window = new BrowserWindow({
        title: `Surface: ${path.basename(resolved)}`,
        width: 900,
        height: 700,
        // Deliberately not a child window: on macOS a child opened over a fullscreen parent
        // leaves the parent's Space blank when it closes. Ownership is tracked below instead.
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(APP_DIR, 'surface-preload.cjs')
        }
    });

    surfacePayloads.set(window.webContents.id, {
        name: path.basename(resolved),
        image: `data:image/png;base64,${bytes.toString('base64')}`
    });

    // Without a parent window these would outlive the page that opened them.
    const owned = surfaceWindows.get(parent) ?? new Set();
    owned.add(window);
    surfaceWindows.set(parent, owned);

    // A fullscreen window owns its own Space, which a normal window would not appear in.
    if (parent?.isFullScreen?.()) {
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    window.on('closed', () => {
        surfacePayloads.delete(window.webContents.id);
        owned.delete(window);
        // Deferred: focusing during teardown is ignored while the closing window still has key status.
        setTimeout(() => { if (parent && !parent.isDestroyed()) parent.focus(); }, 0);
    });
    if (parent) {
        parent.once('closed', () => {
            for (const surface of owned) if (!surface.isDestroyed()) surface.close();
            surfaceWindows.delete(parent);
        });
    }

    window.loadFile(path.join(APP_DIR, 'surface.html'));
    return { name: path.basename(resolved) };
}

function createWindow () {
    const window = new BrowserWindow({
        title: 'Orbital Eyes',
        width: 1024,
        height: 624,
        webPreferences: {
            preload: path.join(APP_DIR, 'preload.cjs')
        }
    });

    window.loadFile(path.join(APP_DIR, 'index.html'));
    window.webContents.openDevTools(); // handy while learning: shows console errors like missing images
    return window;
}

app.whenReady().then(() => {

    ipcMain.handle('composer:catalog', () => sceneStorage.catalog());
    ipcMain.handle('composer:model', (_event, file) => sceneStorage.model(file));
    ipcMain.handle('composer:load', (_event, file) => sceneStorage.load(file));
    ipcMain.handle('composer:save', (_event, file, document, overwrite) =>
        sceneStorage.save(file, document, overwrite === true));
    ipcMain.handle('composer:delete', (_event, file) => sceneStorage.delete(file));
    ipcMain.handle('composer:import', async event => {
        const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
            title: 'Import SynC scene', properties: ['openFile'], filters: [{ name: 'Scene JSON', extensions: ['json'] }]
        });
        if (canceled || !filePaths[0]) return null;
        return sceneStorage.importFile(filePaths[0]);
    });
    let composerPreviewRunning = false;
    ipcMain.handle('composer:preview', async (event, document, cameraName, tabId) => {
        if (composerPreviewRunning) throw new Error('A scene preview is already rendering.');
        validateComposerDocument(document);
        composerPreviewRunning = true;
        try {
            const snapshot = structuredClone(document);
            delete snapshot.trajectory;
            snapshot.scene.render = {
                ...snapshot.scene.render, image_format: 'PNG', color_depth: '8',
                resolution_percentage: Math.max(
                    Math.ceil(100 / Math.min(...snapshot.scene.render.resolution_px)),
                    Math.min(25, snapshot.scene.render.resolution_percentage ?? 100)
                ),
                samples: Math.min(16, snapshot.scene.render.samples ?? 16)
            };
            const runDir = path.join(RUNS_DIR, 'Scene-Preview', `${Date.now()}-${randomUUID()}`);
            await mkdir(runDir, { recursive: true });
            allowedFolders.add(runDir);
            const log = entry => { if (!event.sender.isDestroyed()) event.sender.send('console:log', { tabId, ...entry }); };
            const result = await renderSyntheticScene({
                params_file: path.join(SCENES_DIR, 'preview.json'),
                config_json: JSON.stringify(snapshot), camera_name: cameraName
            }, {
                appDir: APP_DIR, modelsDir: MODELS_DIR, runDir, isAllowed: isInAllowedFolder,
                blender: existsSync('/Applications/Blender.app/Contents/MacOS/Blender')
                    ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender',
                render: (exe, args, options) => executeCli(exe, args, options, log, 'Scene preview')
            });
            return { path: result.files[0], url: pathToFileURL(result.files[0]).href };
        } finally {
            composerPreviewRunning = false;
        }
    });
    ipcMain.handle('vision:run', (event, action, imagePath, params, tabId) =>
        runVisionCli(action, imagePath, params, entry => {
            if (!event.sender.isDestroyed()) event.sender.send('console:log', { tabId, ...entry });
        }));
    ipcMain.handle('vision:actions', () => listActions());
    ipcMain.handle('explorer:openFolder', event => openFolder(BrowserWindow.fromWebContents(event.sender)));
    ipcMain.handle('explorer:chooseFolder', (event, options) =>
        chooseFolder(BrowserWindow.fromWebContents(event.sender), { create: Boolean(options?.create) }));
    ipcMain.handle('explorer:chooseFile', (event, options) =>
        chooseImageFile(BrowserWindow.fromWebContents(event.sender), options));
    ipcMain.handle('results:list', () => listResults());
    ipcMain.handle('results:delete', (_event, targetPath) => deleteResult(targetPath));
    ipcMain.handle('specs:list', (_event, kind) => listSpecs(kind));
    ipcMain.handle('specs:read', (_event, kind, file) => readSpec(kind, file));
    ipcMain.handle('specs:save', (_event, kind, file, content) => saveSpec(kind, file, content));
    ipcMain.handle('workflow:prepareRun', (_event, request) => prepareWorkflowRun(request));
    ipcMain.handle('workflow:run', (event, request) => runWorkflow(event.sender, request));
    ipcMain.handle('workflow:stop', () => stopWorkflow());
    ipcMain.handle('workflow:open', event => openWorkflowFile(BrowserWindow.fromWebContents(event.sender), event.sender.id));
    ipcMain.handle('workflow:save', (event, filePath, document) => saveWorkflow(event.sender.id, filePath, document));
    ipcMain.handle('workflow:saveAs', (event, document) =>
        saveWorkflowAs(BrowserWindow.fromWebContents(event.sender), event.sender.id, document));
    ipcMain.handle('workflow:openArtifact', (_event, filePath, type) => openWorkflowArtifact(filePath, type));
    ipcMain.handle('workflow:readScene', async (_event, filename) => {
        if (typeof filename !== 'string') throw new Error('Scene JSON path is required.');
        const resolved = path.resolve(APP_DIR, expandHome(filename));
        if (!isInAllowedFolder(resolved)) throw new Error('Scene JSON path is not authorized. Choose the file again.');
        return readSceneDocument(resolved);
    });
    ipcMain.handle('surface:open', (event, imagePath) =>
        openSurfaceWindow(BrowserWindow.fromWebContents(event.sender), imagePath));
    ipcMain.handle('surface:payload', event => surfacePayloads.get(event.sender.id) ?? null);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('will-quit', () => {
    // Only scratch is discarded; workflow runs are kept for later inspection.
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});