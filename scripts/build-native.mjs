#!/usr/bin/env node
// Builds every cv-cli tool with CMake and installs them, plus their shared libraries, into native/.
//
//   node scripts/build-native.mjs              vcpkg build (needs VCPKG_ROOT), triplet picked from this machine
//   node scripts/build-native.mjs --system     use the OpenCV already installed (Homebrew, apt, ...)
//   options: --triplet <name>  --clean  --verify-only  --jobs <n>
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanToolFolder } from '../native_tools.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cliDir = path.join(root, 'cv-cli');
const nativeDir = path.join(root, 'native');

const TRIPLETS = {
    'darwin-arm64': 'arm64-osx-oe', 'darwin-x64': 'x64-osx-oe',
    'linux-x64': 'x64-linux-oe', 'linux-arm64': 'arm64-linux-oe',
    'win32-x64': 'x64-windows-oe', 'win32-arm64': 'arm64-windows-oe'
};
// Every element CLI except the optional SURF tool (needs opencv_contrib nonfree).
export const MIN_TOOLS = 30;

function parseArgs(argv) {
    const options = { preset: 'vcpkg', triplet: null, clean: false, verifyOnly: false, jobs: os.availableParallelism?.() ?? os.cpus().length };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--system') options.preset = 'system';
        else if (arg === '--vcpkg') options.preset = 'vcpkg';
        else if (arg === '--triplet') options.triplet = argv[++i];
        else if (arg === '--clean') options.clean = true;
        else if (arg === '--verify-only') options.verifyOnly = true;
        else if (arg === '--jobs') options.jobs = Number(argv[++i]);
        else if (arg === '--help' || arg === '-h') {
            console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 7).map(line => line.replace(/^\/\/ ?/, '')).join('\n'));
            process.exit(0);
        } else throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}

function run(command, args) {
    console.log(`\n> ${command} ${args.join(' ')}`);
    const result = spawnSync(command, args, { cwd: cliDir, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

export function verifyNative(directory = nativeDir) {
    const tools = scanToolFolder(path.join(directory, 'bin'));
    const infoFile = path.join(directory, 'native-info.json');
    const info = existsSync(infoFile) ? JSON.parse(readFileSync(infoFile, 'utf8')) : null;
    const problems = [];
    if (tools.length < MIN_TOOLS) problems.push(`expected at least ${MIN_TOOLS} tools in ${path.join(directory, 'bin')}, found ${tools.length}`);
    if (!info) problems.push(`missing ${infoFile}`);
    return { tools, info, problems };
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.verifyOnly) {
        const binaryDir = path.join(root, 'build', `native-${options.preset}`);
        const configure = ['--preset', options.preset];
        if (options.preset === 'vcpkg') {
            if (!process.env.VCPKG_ROOT) throw new Error('Set VCPKG_ROOT to a vcpkg checkout (or use --system).');
            const triplet = options.triplet ?? TRIPLETS[`${process.platform}-${process.arch}`];
            if (!triplet) throw new Error(`No default vcpkg triplet for ${process.platform}-${process.arch}; pass --triplet.`);
            configure.push(`-DVCPKG_TARGET_TRIPLET=${triplet}`);
        }
        if (options.clean) {
            rmSync(binaryDir, { recursive: true, force: true });
            rmSync(nativeDir, { recursive: true, force: true });
        }
        run('cmake', configure);
        run('cmake', ['--build', '--preset', options.preset, '--parallel', String(options.jobs)]);
        rmSync(path.join(nativeDir, 'bin'), { recursive: true, force: true });
        rmSync(path.join(nativeDir, 'lib'), { recursive: true, force: true });
        run('cmake', ['--install', binaryDir, '--config', 'Release']);
    }
    const { tools, info, problems } = verifyNative();
    console.log(`\nnative/: ${tools.length} tools, OpenCV ${info?.opencv ?? 'unknown'}${info?.vcpkgTriplet ? ` (${info.vcpkgTriplet})` : ''}`);
    if (problems.length) {
        for (const problem of problems) console.error(`error: ${problem}`);
        process.exit(1);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (err) { console.error(`error: ${err.message}`); process.exit(1); }
}
