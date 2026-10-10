import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    defaultBlenderPath, defaultPythonCommand, executableName, findTool, scanToolFolder, toolCandidates, toolNameFromFile
} from './native_tools.js';

test('executable names gain .exe only on Windows', () => {
    assert.equal(executableName('sift_cli', 'win32'), 'sift_cli.exe');
    assert.equal(executableName('sift_cli.exe', 'win32'), 'sift_cli.exe');
    assert.equal(executableName('sift_cli', 'darwin'), 'sift_cli');
    assert.equal(executableName('sift_cli', 'linux'), 'sift_cli');
});

test('tool file names are recognised per platform', () => {
    assert.equal(toolNameFromFile('sift_cli', 'linux'), 'sift_cli');
    assert.equal(toolNameFromFile('sift_cli.exe', 'win32'), 'sift_cli');
    assert.equal(toolNameFromFile('sift_cli', 'win32'), null);
    assert.equal(toolNameFromFile('opencv_core.dll', 'win32'), null);
    assert.equal(toolNameFromFile('libopencv_core.dylib', 'darwin'), null);
});

test('candidates look in native/bin, then the project build, then Release', () => {
    assert.deepEqual(toolCandidates('cpp-sift/build/sift_cli', { cliDir: '/app/cv-cli', nativeDir: '/app/native', platform: 'linux' }), [
        '/app/native/bin/sift_cli', '/app/cv-cli/cpp-sift/build/sift_cli', '/app/cv-cli/cpp-sift/build/Release/sift_cli'
    ]);
    assert.deepEqual(toolCandidates('cpp-sift/build/sift_cli', { cliDir: 'C:\\app\\cv-cli', nativeDir: 'C:\\app\\native', platform: 'win32' }), [
        'C:\\app\\native\\bin\\sift_cli.exe', 'C:\\app\\cv-cli\\cpp-sift\\build\\sift_cli.exe', 'C:\\app\\cv-cli\\cpp-sift\\build\\Release\\sift_cli.exe'
    ]);
});

test('findTool returns the first existing candidate, else the native location', () => {
    const options = { cliDir: '/app/cv-cli', nativeDir: '/app/native', platform: 'linux' };
    assert.equal(findTool('cpp-sift/build/sift_cli', options, file => file === '/app/cv-cli/cpp-sift/build/sift_cli'), '/app/cv-cli/cpp-sift/build/sift_cli');
    assert.equal(findTool('cpp-sift/build/sift_cli', options, () => true), '/app/native/bin/sift_cli');
    assert.equal(findTool('cpp-sift/build/sift_cli', options, () => false), '/app/native/bin/sift_cli');
});

test('Blender is found in the newest Windows install', () => {
    const env = { ProgramFiles: 'C:\\Program Files' };
    const foundation = 'C:\\Program Files\\Blender Foundation';
    const list = directory => (directory === foundation ? ['Blender 3.6', 'Blender 4.10', 'Blender 4.2', 'notes'] : []);
    const exists = file => file.endsWith('blender.exe');
    assert.equal(defaultBlenderPath({ platform: 'win32', env, exists, list }), 'C:\\Program Files\\Blender Foundation\\Blender 4.10\\blender.exe');
    assert.equal(defaultBlenderPath({ platform: 'win32', env, exists: () => false, list }), 'blender');
});

test('Blender defaults on macOS and Linux fall back to PATH', () => {
    assert.equal(defaultBlenderPath({ platform: 'darwin', env: { HOME: '/Users/a' }, exists: file => file.startsWith('/Applications') }),
        '/Applications/Blender.app/Contents/MacOS/Blender');
    assert.equal(defaultBlenderPath({ platform: 'linux', env: {}, exists: file => file === '/snap/bin/blender' }), '/snap/bin/blender');
    assert.equal(defaultBlenderPath({ platform: 'linux', env: {}, exists: () => false }), 'blender');
});

test('python command differs on Windows', () => {
    assert.equal(defaultPythonCommand('win32'), 'python');
    assert.equal(defaultPythonCommand('darwin'), 'python3');
});

test('scanToolFolder lists executable *_cli files only', { skip: process.platform === 'win32' }, async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'native-tools-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, 'sift_cli'), '');
    await chmod(path.join(directory, 'sift_cli'), 0o755);
    await writeFile(path.join(directory, 'orb_cli'), '');
    await writeFile(path.join(directory, 'libopencv_core.dylib'), '');
    await mkdir(path.join(directory, 'dir_cli'));
    assert.deepEqual(scanToolFolder(directory).map(tool => tool.name), ['sift_cli']);
    assert.deepEqual(scanToolFolder(path.join(directory, 'missing')), []);
});
