// Platform-aware helpers for finding the native OpenCV tools and external programs.
// Kept free of Electron imports so build scripts and tests can use it too.
import path from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

export const IS_WINDOWS = process.platform === 'win32';

export function executableName(name, platform = process.platform) {
    return platform === 'win32' && !/\.exe$/i.test(name) ? `${name}.exe` : name;
}

// 'sift_cli' / 'sift_cli.exe' -> 'sift_cli'; anything else -> null.
export function toolNameFromFile(fileName, platform = process.platform) {
    const base = platform === 'win32' ? fileName.replace(/\.exe$/i, '') : fileName;
    if (platform === 'win32' && base === fileName) return null;
    return /_cli$/.test(base) ? base : null;
}

// Element definitions keep the historical 'cpp-sift/build/sift_cli' form. Look for the tool in the
// unified install (native/bin), then the per-project build folder, then a multi-config Release folder.
export function toolCandidates(relative, { cliDir, nativeDir, platform = process.platform }) {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const name = executableName(pathApi.basename(relative), platform);
    const projectBuild = pathApi.join(cliDir, pathApi.dirname(relative));
    return [
        pathApi.join(nativeDir, 'bin', name),
        pathApi.join(projectBuild, name),
        pathApi.join(projectBuild, 'Release', name)
    ];
}

export function findTool(relative, options, exists = existsSync) {
    const candidates = toolCandidates(relative, options);
    return candidates.find(candidate => exists(candidate)) ?? candidates[0];
}

function listDir(directory) {
    try { return readdirSync(directory); } catch { return []; }
}

const NEWEST_FIRST = (a, b) => b.localeCompare(a, undefined, { numeric: true });

// Best guess at Blender's location when app.json does not set blenderPath.
// A bare 'blender' falls back to PATH lookup (libuv also tries '.exe' on Windows).
export function defaultBlenderPath({ platform = process.platform, env = process.env, exists = existsSync, list = listDir } = {}) {
    if (platform === 'darwin') {
        const candidates = ['/Applications/Blender.app/Contents/MacOS/Blender', path.join(env.HOME ?? '', 'Applications/Blender.app/Contents/MacOS/Blender')];
        return candidates.find(candidate => exists(candidate)) ?? 'blender';
    }
    if (platform === 'win32') {
        const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
        for (const root of roots) {
            const foundation = path.win32.join(root, 'Blender Foundation');
            for (const version of list(foundation).filter(name => /^blender/i.test(name)).sort(NEWEST_FIRST)) {
                const candidate = path.win32.join(foundation, version, 'blender.exe');
                if (exists(candidate)) return candidate;
            }
        }
        return 'blender';
    }
    const candidates = ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', '/var/lib/flatpak/exports/bin/org.blender.Blender', '/opt/blender/blender'];
    return candidates.find(candidate => exists(candidate)) ?? 'blender';
}

export function defaultPythonCommand(platform = process.platform) {
    return platform === 'win32' ? 'python' : 'python3';
}

// The tools that are actually present in one folder (Unix needs the executable bit; Windows needs .exe).
export function scanToolFolder(directory, platform = process.platform) {
    const tools = [];
    for (const fileName of listDir(directory)) {
        const name = toolNameFromFile(fileName, platform);
        if (!name) continue;
        let info;
        try { info = statSync(path.join(directory, fileName)); } catch { continue; }
        if (!info.isFile() || (platform !== 'win32' && !(info.mode & 0o111))) continue;
        tools.push({ name, file: path.join(directory, fileName), built: info.mtime.toISOString() });
    }
    return tools;
}
