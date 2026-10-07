import { readdir, realpath, stat, readFile, writeFile, mkdir, rename, unlink, lstat, link } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { SCENE_MAX_BYTES } from './scene_document.js';
import { validateComposerDocument } from './scene_composer_document.js';

export function configuredFolder(appDir, value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Configured folder must be a nonempty path.');
    const expanded = value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
    return path.resolve(appDir, expanded);
}

export function createSceneStorage({ modelsDir, scenesDir }) {
    const filename = (file, extension) => {
        if (typeof file !== 'string' || !file || file !== path.basename(file) ||
            /[/\\]/.test(file) || path.extname(file).toLowerCase() !== extension) throw new Error(`Expected a ${extension} filename, not a path.`);
        return file;
    };
    async function regularFile(directory, file, extension) {
        const root = await realpath(directory);
        const target = path.join(root, filename(file, extension));
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(target)) !== root) throw new Error('Only regular files inside the configured folder are allowed.');
        return { target, info };
    }
    async function readDocument(target) {
        if ((await stat(target)).size > SCENE_MAX_BYTES) throw new Error('Scene JSON exceeds 1 MB.');
        const text = await readFile(target, 'utf8');
        return validateComposerDocument(JSON.parse(text));
    }
    return {
        async catalog() {
            await mkdir(scenesDir, { recursive: true });
            const files = async (directory, extension) => (await readdir(directory, { withFileTypes: true }))
                .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === extension)
                .map(entry => entry.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            return { modelsDir, scenesDir, models: await files(modelsDir, '.glb'), scenes: await files(scenesDir, '.json') };
        },
        async model(file) {
            const { target, info } = await regularFile(modelsDir, file, '.glb');
            if (info.size > 256 * 1024 * 1024) throw new Error('GLB exceeds the 256 MB preview limit.');
            return new Uint8Array(await readFile(target));
        },
        async load(file) {
            const { target } = await regularFile(scenesDir, file, '.json');
            return { file, path: target, document: await readDocument(target) };
        },
        async importFile(target) {
            if (path.extname(target).toLowerCase() !== '.json' || !(await stat(target)).isFile()) throw new Error('Choose a scene JSON file.');
            return { file: null, path: target, document: await readDocument(target) };
        },
        async save(file, document, overwrite = false) {
            validateComposerDocument(document);
            await mkdir(scenesDir, { recursive: true });
            const root = await realpath(scenesDir);
            const target = path.join(root, filename(file, '.json'));
            let present = false;
            try {
                await regularFile(scenesDir, file, '.json');
                present = true;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            if (present && !overwrite) throw new Error('A scene with that filename already exists. Choose another name or load it to overwrite.');
            if (!present && overwrite) throw new Error('Saved scene no longer exists. Use Save As.');
            const temporary = `${target}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
                if (!overwrite) {
                    // Exclusive create prevents a concurrent save from replacing another scene.
                    await link(temporary, target);
                    await unlink(temporary);
                } else await rename(temporary, target);
            } catch (error) {
                await unlink(temporary).catch(cleanup => { if (cleanup.code !== 'ENOENT') console.error('Scene temporary-file cleanup failed:', cleanup); });
                throw error;
            }
            return { file, path: target };
        },
        async delete(file) {
            const { target } = await regularFile(scenesDir, file, '.json');
            await unlink(target);
        }
    };
}
