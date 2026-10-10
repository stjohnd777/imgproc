#!/usr/bin/env node
// Runs a handful of the installed native tools on img/one.png with each element's default parameters.
// Proves the tools start, find their shared libraries and can read and write images.
//   node scripts/smoke-native.mjs [--native-dir <dir>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableName } from '../native_tools.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const ELEMENTS = ['gaussian', 'canny', 'clahe', 'threshold', 'sobel', 'sift', 'orb', 'fast', 'histogram'];

const argIndex = process.argv.indexOf('--native-dir');
const nativeDir = argIndex > 0 ? path.resolve(process.argv[argIndex + 1]) : path.join(root, 'native');
const input = path.join(root, 'img', 'one.png');
const work = mkdtempSync(path.join(os.tmpdir(), 'oe-smoke-'));

function argsFor(spec) {
    const outputs = [];
    const args = spec.exec.args.map(arg => {
        const [, kind, name] = arg.match(/^\{(in|out|param)\.(.+)\}$/) ?? [];
        if (kind === 'in') return input;
        if (kind === 'out') {
            const port = Object.values(spec.outputs ?? {}).find(output => output.name === name);
            const extension = port?.type === 'json' || /keypoints|json|histogram/i.test(name) ? 'json' : 'png';
            const file = path.join(work, `${spec.exec.cli.split('/').pop()}_${name}.${extension}`);
            outputs.push(file);
            return file;
        }
        if (kind === 'param') {
            const value = spec.params?.[name]?.default;
            if (value === undefined) throw new Error(`no default for ${arg}`);
            return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
        }
        return arg;
    });
    return { args, outputs };
}

let failures = 0;
try {
    for (const element of ELEMENTS) {
        const specFile = path.join(root, 'elements', `${element}.json`);
        if (!existsSync(specFile)) continue;
        const spec = JSON.parse(readFileSync(specFile, 'utf8'));
        const exe = path.join(nativeDir, 'bin', executableName(path.basename(spec.exec.cli)));
        const { args, outputs } = argsFor(spec);
        const result = spawnSync(exe, args, { encoding: 'utf8', timeout: 60000 });
        const missing = outputs.filter(file => !existsSync(file) || statSync(file).size === 0);
        const ok = result.status === 0 && missing.length === 0;
        if (!ok) failures++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${element.padEnd(10)} ${ok ? '' : (result.error?.message ?? result.stderr.trim()) || `missing ${missing.join(', ')}`}`);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
if (failures) {
    console.error(`${failures} smoke test(s) failed`);
    process.exit(1);
}
console.log(`native smoke tests passed (${nativeDir})`);
