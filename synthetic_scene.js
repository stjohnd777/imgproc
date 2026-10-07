import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SCENE_MAX_BYTES, parseSceneDocument, selectSceneCamera } from './scene_document.js';

export async function readSceneDocument(filename) {
    if ((await stat(filename)).size > SCENE_MAX_BYTES) throw new Error('Scene JSON exceeds 1 MB.');
    const text = await readFile(filename, 'utf8');
    parseSceneDocument(text);
    return text;
}

export async function renderSyntheticScene(params, {
    appDir, runDir, blender, isAllowed, render = promisify(execFile)
}) {
    const filename = path.resolve(appDir, params.params_file || 'SynC/scenes/Cassini-Huygens-30m-BFLY-PGE-F12mm-B120.0mm/params.json');
    if (!isAllowed(filename)) throw new Error('Scene JSON path is not authorized. Choose the file again.');
    const document = parseSceneDocument(params.config_json ?? await readSceneDocument(filename));
    const camera = selectSceneCamera(document, params.camera_name);
    if (!['PNG', 'JPEG', 'BMP', 'WEBP'].includes(document.scene.render?.image_format)) {
        throw new Error('Synthetic Scene requires a viewable output image format. Set scene.render.image_format to PNG.');
    }
    const modelsDir = path.join(appDir, 'SynC', 'models');
    for (const model of document.models) {
        const asset = path.resolve(modelsDir, model.file);
        if (!isAllowed(asset)) throw new Error(`Model asset is not authorized: ${model.file}`);
        if (!(await stat(asset)).isFile()) throw new Error(`Model asset is not a file: ${model.file}`);
    }
    // Keep the complete rig and trajectory: filtering cameras changes orbit rig centers.
    document.output = { ...document.output, log_filename: 'render_manifest.json' };
    await mkdir(path.join(runDir, 'sources'), { recursive: true });
    const outputDir = await mkdtemp(path.join(runDir, 'sources', 'scene-'));
    const snapshot = path.join(outputDir, 'params.json');
    await writeFile(snapshot, JSON.stringify(document, null, 2), 'utf8');
    try {
        await render(blender, [
            '--background', '--python-exit-code', '1',
            '--python', path.join(appDir, 'SynC', 'pylib', 'render_scene.py'), '--',
            '--params', snapshot, '--output-dir', outputDir, '--models-dir', modelsDir
        ], {
            timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
        });
    } catch (error) {
        throw new Error(`Synthetic Scene render failed: ${error.stderr || error.message}\nRender files: ${outputDir}`);
    }
    const manifest = JSON.parse(await readFile(path.join(outputDir, 'render_manifest.json'), 'utf8'));
    if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) {
        throw new Error('Synthetic Scene renderer produced no frames.');
    }
    const files = [];
    for (const frame of manifest.frames) {
        const relative = frame.images?.[camera];
        if (typeof relative !== 'string') throw new Error(`Renderer did not produce camera "${camera}".`);
        const file = path.resolve(outputDir, relative);
        const inside = path.relative(outputDir, file);
        if (inside.startsWith('..') || path.isAbsolute(inside) ||
            !['.png', '.jpg', '.jpeg', '.bmp', '.webp'].includes(path.extname(file).toLowerCase())) {
            throw new Error('Scene output must be a viewable image inside its render directory. Use PNG.');
        }
        if (!(await stat(file)).isFile()) throw new Error(`Rendered image is not a file: ${file}`);
        files.push(file);
    }
    return { files, outputDir };
}
