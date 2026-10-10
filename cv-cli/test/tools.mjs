// Resolves a native tool the same way the app does: native/bin first, then the per-project build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { executableName, findTool } from '../../native_tools.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

export const nativeTool = relative => findTool(relative, {
    cliDir: path.join(root, 'cv-cli'),
    nativeDir: process.env.OE_NATIVE_DIR ? path.resolve(process.env.OE_NATIVE_DIR) : path.join(root, 'native')
});

// Test-only executables (not installed to native/): the per-project build, then the superbuild trees.
export const testExecutable = (project, name) => {
    const file = executableName(name);
    const candidates = [
        path.join(root, 'cv-cli', project, 'build', file),
        ...['native-vcpkg', 'native-system'].flatMap(tree => [
            path.join(root, 'build', tree, project, file), path.join(root, 'build', tree, project, 'Release', file)
        ])
    ];
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
};
