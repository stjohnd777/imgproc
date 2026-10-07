import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { renderArgs } from '../../workflow_args.js';
import { cameraParameters } from '../../camera_parameters.js';
import { View } from '../../View.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = path.join(root, 'cv-cli/cpp-image-effects/build');

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let i = 0; i < 8; ++i) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4), footer = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, footer]);
}

function writePng(filename, width, height, channels, depth, values) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = depth;
    header[9] = { 1: 0, 3: 2, 4: 6 }[channels];
    const stride = width * channels * depth / 8;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; ++y) {
        for (let i = 0; i < width * channels; ++i) {
            const value = values[(y * width * channels) + i];
            const offset = y * (stride + 1) + 1 + i * depth / 8;
            if (depth === 16) raw.writeUInt16BE(value, offset);
            else raw[offset] = value;
        }
    }
    writeFileSync(filename, Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
    ]));
}

function readPng(filename) {
    const png = readFileSync(filename), compressed = [];
    let width, height, depth, channels;
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
        const data = png.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8];
            channels = { 0: 1, 2: 3, 6: 4 }[data[9]];
            assert.ok(channels && [8, 16].includes(depth));
            assert.equal(data[12], 0, 'noninterlaced fixture output');
        }
        if (type === 'IDAT') compressed.push(data);
        offset += length + 12;
    }
    const bpp = channels * depth / 8, stride = width * bpp;
    const raw = inflateSync(Buffer.concat(compressed)), decoded = Buffer.alloc(stride * height);
    for (let y = 0; y < height; ++y) {
        const filter = raw[y * (stride + 1)];
        assert.ok(filter <= 4);
        for (let x = 0; x < stride; ++x) {
            const pos = y * stride + x;
            const a = x >= bpp ? decoded[pos - bpp] : 0;
            const b = y ? decoded[pos - stride] : 0;
            const c = y && x >= bpp ? decoded[pos - stride - bpp] : 0;
            const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            const predictor = [0, a, b, Math.floor((a + b) / 2), paeth][filter];
            decoded[pos] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255;
        }
    }
    const values = depth === 8 ? [...decoded] :
        Array.from({ length: decoded.length / 2 }, (_, i) => decoded.readUInt16BE(i * 2));
    return { width, height, channels, depth, values };
}

function fixture(t) {
    const dir = mkdtempSync(path.join(tmpdir(), 'image-effects-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

function run(tool, args, success = true) {
    const result = spawnSync(path.join(project, `${tool}_cli`), args.map(String), { encoding: 'utf8' });
    if (success) assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    else {
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.trim(), 'failure must explain the error');
    }
    return result;
}

test('concatenation workflows preserve exact pixels, depth, channels and input order with unequal sizes', t => {
    const dir = fixture(t);
    const img0 = path.join(dir, 'img0.png'), img1 = path.join(dir, 'img1.png');
    const output = path.join(dir, 'joined.png');
    for (const tool of ['hconcat', 'vconcat']) {
        const element = JSON.parse(readFileSync(path.join(root, `elements/${tool}.json`)));
        assert.equal(element.kind, 'transform');
        assert.equal(element.category, 'utility');
        assert.deepEqual(element.inputs, [{ name: 'img0', type: 'image' }, { name: 'img1', type: 'image' }]);
        assert.deepEqual(element.outputs, [{ name: 'image', type: 'image' }]);
        assert.deepEqual(element.params, {});
        const horizontal = tool === 'hconcat';
        for (const depth of [8, 16]) {
            for (const channels of [1, 3, 4]) {
                const width0 = 2, height0 = 2;
                const width1 = horizontal ? 3 : 2, height1 = horizontal ? 2 : 3;
                const scale = depth === 16 ? 257 : 1;
                const a = Array.from({ length: width0 * height0 * channels }, (_, i) => (i * 7 % 256) * scale);
                const b = Array.from({ length: width1 * height1 * channels }, (_, i) => (255 - i * 3 % 256) * scale);
                writePng(img0, width0, height0, channels, depth, a);
                writePng(img1, width1, height1, channels, depth, b);
                const args = renderArgs(element.exec.args, {
                    inputs: { img0, img1 }, outputs: { image: output }, params: {}
                });
                assert.deepEqual(args, [img0, img1, output]);
                run(tool, args);
                const expected = horizontal
                    ? Array.from({ length: height0 }, (_, y) => [
                        ...a.slice(y * width0 * channels, (y + 1) * width0 * channels),
                        ...b.slice(y * width1 * channels, (y + 1) * width1 * channels)
                    ]).flat()
                    : [...a, ...b];
                assert.deepEqual(readPng(output), {
                    width: horizontal ? width0 + width1 : width0,
                    height: horizontal ? height0 : height0 + height1,
                    channels, depth, values: expected
                });
            }
        }
    }
});

test('concatenation reports incompatible sizes/types and CLI I/O errors', t => {
    const dir = fixture(t);
    const a = path.join(dir, 'a.png'), b = path.join(dir, 'b.png'), output = path.join(dir, 'out.png');
    writePng(a, 2, 2, 1, 8, [1, 2, 3, 4]);
    for (const tool of ['hconcat', 'vconcat']) {
        writePng(b, 3, 3, 1, 8, Array(9).fill(0));
        assert.match(run(tool, [a, b, output], false).stderr, tool === 'hconcat' ? /heights/ : /widths/);
        for (const [channels, depth] of [[3, 8], [1, 16]]) {
            writePng(b, 2, 2, channels, depth, Array(4 * channels).fill(0));
            assert.match(run(tool, [a, b, output], false).stderr, /depth and channel/);
        }
        assert.match(run(tool, [], false).stderr, /Usage/);
        assert.match(run(tool, [path.join(dir, 'missing.png'), a, output], false).stderr, /load input/);
        assert.match(run(tool, [a, a, path.join(dir, 'missing', 'out.png')], false).stderr, /write output/);
    }
});

test('Image Diff workflow compares two inputs and produces exact symmetric differences', t => {
    const dir = fixture(t);
    const img0 = path.join(dir, 'img0.png'), img1 = path.join(dir, 'img1.png');
    const output = path.join(dir, 'diff.png');
    const element = JSON.parse(readFileSync(path.join(root, 'elements/image_diff.json')));
    assert.equal(element.kind, 'transform');
    assert.equal(element.category, 'analysis');
    assert.deepEqual(element.inputs, [
        { name: 'img0', type: 'image' }, { name: 'img1', type: 'image' }
    ]);
    assert.deepEqual(element.outputs, [{ name: 'diff', type: 'image' }]);
    assert.deepEqual(element.params, {});
    for (const depth of [8, 16]) {
        const max = depth === 8 ? 255 : 65535;
        for (const channels of [1, 3, 4]) {
            const a = Array.from({ length: 6 * channels }, (_, i) =>
                [0, max, 10, 15, Math.floor(max / 2), 1][i % 6]);
            const b = Array.from({ length: a.length }, (_, i) =>
                [max, 0, 15, 10, 0, max][i % 6]);
            const expected = a.map((value, i) =>
                channels === 4 && i % 4 === 3 ? max : Math.abs(value - b[i]));
            writePng(img0, 3, 2, channels, depth, a);
            writePng(img1, 3, 2, channels, depth, b);
            const args = renderArgs(element.exec.args, {
                inputs: { img0, img1 }, outputs: { diff: output }, params: {}
            });
            assert.deepEqual(args, [img0, img1, output]);
            run('image_diff', args);
            assert.deepEqual(readPng(output), { width: 3, height: 2, channels, depth, values: expected });
            run('image_diff', [img1, img0, output]);
            assert.deepEqual(readPng(output).values, expected);
            run('image_diff', [img0, img0, output]);
            assert.deepEqual(readPng(output).values,
                a.map((_, i) => channels === 4 && i % 4 === 3 ? max : 0));
            if (channels === 4) {
                const alphaOnly = a.map((value, i) => i % 4 === 3 ? max - value : value);
                writePng(img1, 3, 2, channels, depth, alphaOnly);
                run('image_diff', [img0, img1, output]);
                assert.deepEqual(readPng(output).values,
                    a.map((_, i) => i % 4 === 3 ? max : 0));
            }
        }
    }
});

test('Image Diff reports incompatible inputs, usage, read, and write errors', t => {
    const dir = fixture(t);
    const img0 = path.join(dir, 'img0.png'), img1 = path.join(dir, 'img1.png');
    const output = path.join(dir, 'diff.png'), missing = path.join(dir, 'missing.png');
    writePng(img0, 3, 2, 1, 8, Array(6).fill(10));
    for (const [width, height, channels, depth, message] of [
        [2, 2, 1, 8, /matching image dimensions/],
        [3, 3, 1, 8, /matching image dimensions/],
        [3, 2, 1, 16, /matching bit depth and channel count/],
        [3, 2, 3, 8, /matching bit depth and channel count/]
    ]) {
        writePng(img1, width, height, channels, depth, Array(width * height * channels).fill(10));
        assert.match(run('image_diff', [img0, img1, output], false).stderr, message);
    }
    assert.match(run('image_diff', [], false).stderr, /Usage:/);
    assert.match(run('image_diff', [img0, img0, output, 'extra'], false).stderr, /Usage:/);
    assert.match(run('image_diff', [missing, img0, output], false).stderr, /Failed to load input image/);
    assert.match(run('image_diff', [img0, missing, output], false).stderr, /Failed to load input image/);
    run('image_diff', [img0, img0, path.join(dir, 'unavailable/diff.png')], false);
});

test('workflow declarations, frame expansion, and camera profile fill-in', () => {
    for (const id of ['distort', 'add_noise']) {
        const element = JSON.parse(readFileSync(path.join(root, `elements/${id}.json`)));
        assert.equal(element.kind, 'transform');
        assert.deepEqual(element.inputs, [{ name: 'image', type: 'image' }]);
        assert.deepEqual(element.outputs, element.inputs);
        const params = Object.fromEntries(Object.entries(element.params).map(([key, spec]) => [key, spec.default]));
        const fields = View.prototype.elementParamSpecs.call({
            specs: { cameras: { specs: [{ file: 'camera.json', spec: { name: 'Test Camera' } }] } }
        }, element);
        assert.equal(fields.find(field => field.name === (id === 'distort' ? 'fx' : 'sigma')).default,
            id === 'distort' ? 1000 : 5);
        if (id === 'distort') {
            assert.equal(fields.find(field => field.name === 'camera').type, 'enum');
            assert.equal(fields.find(field => field.name === 'camera').values[1].value, 'camera.json');
        } else {
            assert.equal(fields.find(field => field.name === 'seed').step, 1);
        }
        const args = renderArgs(element.exec.args, {
            inputs: { image: 'in.png' }, outputs: { image: 'out.png' }, params, frameIndex: 7
        });
        assert.equal(args[0], 'in.png');
        assert.equal(args[1], 'out.png');
        assert.ok(args.every(arg => !arg.includes('{')));
        if (id === 'add_noise') assert.deepEqual(args.slice(2), ['5', '0', '7']);
    }
    assert.deepEqual(renderArgs(['{param.enabled}', '{param.absent}', 'literal'], {
        inputs: {}, outputs: {}, params: { enabled: true }
    }), ['1', '', 'literal']);
    assert.throws(() => renderArgs(['{frame.index}'], { inputs: {}, outputs: {}, params: {} }), /frame index/);
    const spec = { intrinsics: { K: [[800, 0, 63], [0, 810, 62], [0, 0, 1]], distortion: [0.1, 0.2, 0.01, 0.02, 0.3] } };
    assert.deepEqual(cameraParameters(spec), { fx: 800, fy: 810, cx: 63, cy: 62, k1: 0.1, k2: 0.2, p1: 0.01, p2: 0.02, k3: 0.3 });
    assert.equal(cameraParameters({}), null);
    assert.equal(cameraParameters({ intrinsics: { K: [[1], [2], [3]] } }), null);
    assert.equal(cameraParameters({ intrinsics: { ...spec.intrinsics, distortion: [NaN] } }), null);
    assert.deepEqual(cameraParameters({ intrinsics: { K: spec.intrinsics.K } }),
        { fx: 800, fy: 810, cx: 63, cy: 62, k1: 0, k2: 0, p1: 0, p2: 0, k3: 0 });
});

test('zero effects preserve grayscale, RGB, RGBA and 8/16-bit pixels exactly', t => {
    const dir = fixture(t);
    for (const channels of [1, 3, 4]) {
        for (const depth of [8, 16]) {
            const values = Array.from({ length: 16 * 12 * channels }, (_, i) => (i * 37) % (depth === 8 ? 256 : 65536));
            const input = path.join(dir, 'in.png'), output = path.join(dir, 'out.png');
            writePng(input, 16, 12, channels, depth, values);
            run('distort', [input, output, 80, 80, 7.5, 5.5, 0, 0, 0, 0, 0]);
            assert.deepEqual(readPng(output), { width: 16, height: 12, channels, depth, values });
            run('add_noise', [input, output, 0]);
            assert.deepEqual(readPng(output).values, values);
        }
    }
});

test('radial distortion samples the inverse map in the correct direction', t => {
    const dir = fixture(t), input = path.join(dir, 'ramp.png'), output = path.join(dir, 'distorted.png');
    const values = Array.from({ length: 129 * 129 }, (_, i) => i % 129);
    writePng(input, 129, 129, 1, 8, values);
    run('distort', [input, output, 80, 80, 64, 64, 0.3, 0, 0, 0, 0]);
    const result = readPng(output);
    const rd = (100 - 64) / 80;
    let r = rd;
    for (let i = 0; i < 20; ++i) r -= (r + 0.3 * r ** 3 - rd) / (1 + 0.9 * r ** 2);
    const expected = 64 + 80 * r;
    assert.ok(Math.abs(result.values[64 * 129 + 100] - expected) <= 0.6);
    assert.ok(result.values[64 * 129 + 100] < 100);
    assert.equal(result.values[64 * 129 + 64], 64);
    run('distort', [input, output, 80, 80, 64, 64, -0.05, 0, 0, 0]);
    assert.equal(readPng(output).values[64 * 129 + 128], 0, 'outside the source is black');
});

test('tangential and radial model agrees with independent forward projection', t => {
    const dir = fixture(t), input = path.join(dir, 'grid.png'), output = path.join(dir, 'out.png');
    const values = Array.from({ length: 129 * 129 * 3 }, (_, i) => {
        const pixel = Math.floor(i / 3);
        return i % 3 === 0 ? pixel % 129 : i % 3 === 1 ? Math.floor(pixel / 129) : 100;
    });
    writePng(input, 129, 129, 3, 8, values);
    const coefficients = [0.1, 0.01, 0.02, -0.01, 0.005];
    run('distort', [input, output, 80, 80, 64, 64, ...coefficients]);
    const result = readPng(output);
    for (const [u, v] of [[30, 40], [100, 90], [65, 60]]) {
        const pos = (v * 129 + u) * 3;
        const x = (result.values[pos] - 64) / 80, y = (result.values[pos + 1] - 64) / 80;
        const r2 = x * x + y * y;
        const radial = 1 + coefficients[0] * r2 + coefficients[1] * r2 ** 2 + coefficients[4] * r2 ** 3;
        const xd = x * radial + 2 * coefficients[2] * x * y + coefficients[3] * (r2 + 2 * x * x);
        const yd = y * radial + coefficients[2] * (r2 + 2 * y * y) + 2 * coefficients[3] * x * y;
        assert.ok(Math.abs(80 * xd + 64 - u) < 0.8);
        assert.ok(Math.abs(80 * yd + 64 - v) < 0.8);
    }
});

test('Distort Image then existing Undistort approximately recovers interior pixels', t => {
    const dir = fixture(t), input = path.join(dir, 'ramp.png');
    const distorted = path.join(dir, 'distorted.png'), output = path.join(dir, 'recovered.png');
    const values = Array.from({ length: 129 * 129 * 3 }, (_, i) => {
        const pixel = Math.floor(i / 3);
        return i % 3 === 0 ? pixel % 129 : i % 3 === 1 ? Math.floor(pixel / 129) : 100;
    });
    writePng(input, 129, 129, 3, 8, values);
    const parameters = [80, 80, 64, 64, 0.1, 0.01, 0.002, -0.001, 0.005];
    run('distort', [input, distorted, ...parameters]);
    const result = spawnSync(path.join(root, 'cv-cli/cpp-undistort/build/undistort_cli'),
        [distorted, output, ...parameters.map(String)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    const recovered = readPng(output);
    let total = 0, maximum = 0, count = 0;
    for (let y = 16; y < 113; ++y) {
        for (let x = 16; x < 113; ++x) {
            for (let c = 0; c < 3; ++c) {
                const i = (y * 129 + x) * 3 + c;
                const error = Math.abs(recovered.values[i] - values[i]);
                total += error; maximum = Math.max(maximum, error); count++;
            }
        }
    }
    assert.ok(total / count < 0.5, `mean error=${total / count}`);
    assert.ok(maximum <= 2, `maximum error=${maximum}`);
});

test('Gaussian noise meets sigma/mean thresholds and repeats by seed/frame', t => {
    const dir = fixture(t), input = path.join(dir, 'flat.png'), output = path.join(dir, 'noisy.png');
    writePng(input, 256, 256, 1, 8, Array(256 * 256).fill(128));
    run('add_noise', [input, output, 10, 42, 0]);
    const first = readPng(output).values;
    const mean = first.reduce((sum, value) => sum + value - 128, 0) / first.length;
    const sd = Math.sqrt(first.reduce((sum, value) => sum + (value - 128 - mean) ** 2, 0) / first.length);
    assert.ok(Math.abs(mean) < 0.2, `mean=${mean}`);
    assert.ok(Math.abs(sd - 10) < 0.2, `sd=${sd}`);
    run('add_noise', [input, output, 10, 42, 0]);
    assert.deepEqual(readPng(output).values, first);
    run('add_noise', [input, output, 10, 42, 1]);
    assert.notDeepEqual(readPng(output).values, first);
    run('add_noise', [input, output, 10, 43, 0]);
    assert.notDeepEqual(readPng(output).values, first);
});

test('noise preserves alpha, scales 16-bit sigma, and clips without wraparound', t => {
    const dir = fixture(t), input = path.join(dir, 'rgba.png'), output = path.join(dir, 'noisy.png');
    const count = 128 * 128;
    const values = Array.from({ length: count * 4 }, (_, i) => i % 4 === 3 ? i % 65536 : 32768);
    writePng(input, 128, 128, 4, 16, values);
    run('add_noise', [input, output, 5, 10, 0]);
    const result = readPng(output);
    assert.equal(result.depth, 16);
    assert.equal(result.channels, 4);
    const errors = [];
    for (let i = 0; i < values.length; ++i) {
        if (i % 4 === 3) assert.equal(result.values[i], values[i]);
        else errors.push(result.values[i] - values[i]);
    }
    const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
    const sd = Math.sqrt(errors.reduce((sum, value) => sum + (value - mean) ** 2, 0) / errors.length);
    assert.ok(Math.abs(sd / 257 - 5) < 0.15);
    run('add_noise', [input, output, 1e6, 10, 0]);
    const clipped = readPng(output).values.filter((_, i) => i % 4 !== 3);
    assert.ok(clipped.includes(0) && clipped.includes(65535));
});

test('invalid parameters, unavailable input, inversion and write failures are explicit', t => {
    const dir = fixture(t), input = path.join(dir, 'in.png'), output = path.join(dir, 'out.png');
    writePng(input, 32, 32, 1, 8, Array(1024).fill(128));
    for (const sigma of ['-1', 'nan', 'inf', '5bad']) run('add_noise', [input, output, sigma], false);
    for (const seed of ['-1', '1.5', '2147483648']) run('add_noise', [input, output, 5, seed], false);
    run('add_noise', [input, output, 5, 0, -1], false);
    run('add_noise', [path.join(dir, 'missing.png'), output], false);
    run('add_noise', [input, path.join(dir, 'missing/out.png')], false);
    for (const fx of ['0', '-1', 'nan', '1bad']) run('distort', [input, output, fx, 80, 16, 16, 0, 0, 0, 0], false);
    run('distort', [input, output, 10, 10, 16, 16, -10, 0, 0, 0], false);
    run('distort', [input, output], false);
});

test('new filters declare editable defaults and execute the workflow argument templates', t => {
    const dir = fixture(t), input = path.join(dir, 'input.png'), output = path.join(dir, 'output.png');
    writePng(input, 32, 32, 1, 8, Array.from({ length: 1024 }, (_, i) => 100 + i % 30));
    for (const id of ['bilateral', 'clahe', 'morphology']) {
        const element = JSON.parse(readFileSync(path.join(root, `elements/${id}.json`)));
        assert.equal(element.kind, 'transform');
        assert.equal(element.category, id === 'morphology' ? 'segmentation' : 'enhancement');
        assert.deepEqual(element.inputs, [{ name: 'image', type: 'image' }]);
        assert.deepEqual(element.outputs, element.inputs);
        const params = Object.fromEntries(Object.entries(element.params).map(([key, spec]) => [key, spec.default]));
        const fields = View.prototype.elementParamSpecs.call({}, element);
        assert.equal(fields.length, Object.keys(params).length);
        if (id === 'morphology') {
            assert.equal(fields.find(field => field.name === 'operation').type, 'enum');
            assert.equal(fields.find(field => field.name === 'kernel_size').step, 2);
        }
        const args = renderArgs(element.exec.args, { inputs: { image: input }, outputs: { image: output }, params });
        const result = spawnSync(path.join(root, 'cv-cli', element.exec.cli), args, { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const image = readPng(output);
        assert.equal(image.width, 32);
        assert.equal(image.height, 32);
        assert.equal(image.channels, 1);
        assert.equal(image.depth, 8);
        run(id, [input, output]); // Standalone defaults match the workflow defaults.
        assert.deepEqual(readPng(output), image);
    }
});

test('bilateral reduces noise while preserving a sharp intensity step', t => {
    const dir = fixture(t), input = path.join(dir, 'noisy.png'), output = path.join(dir, 'filtered.png');
    const width = 64, height = 48;
    const ideal = Array.from({ length: width * height }, (_, i) => i % width < 32 ? 50 : 200);
    const noisy = ideal.map((value, i) => value + ((i * 17 + Math.floor(i / width) * 7) % 21) - 10);
    writePng(input, width, height, 1, 8, noisy);
    run('bilateral', [input, output, 9, 25, 5]);
    const filtered = readPng(output).values;
    let before = 0, after = 0;
    for (let y = 5; y < height - 5; ++y) {
        for (let x = 5; x < width - 5; ++x) {
            const i = y * width + x;
            before += (noisy[i] - ideal[i]) ** 2;
            after += (filtered[i] - ideal[i]) ** 2;
        }
        assert.ok(filtered[y * width + 31] < 65, 'dark edge stays dark');
        assert.ok(filtered[y * width + 32] > 185, 'bright edge stays bright');
    }
    assert.ok(after < before * 0.25, `noise MSE ratio=${after / before}`);
});

test('CLAHE increases low-contrast range and treats neutral RGB as luminance', t => {
    const dir = fixture(t), input = path.join(dir, 'contrast.png'), output = path.join(dir, 'out.png');
    const values = Array.from({ length: 64 * 64 }, (_, i) => 100 + i % 16);
    writePng(input, 64, 64, 1, 8, values);
    run('clahe', [input, output, 4, 4, 4]);
    const gray = readPng(output).values;
    assert.ok(Math.max(...gray) - Math.min(...gray) > 25, 'local contrast increases beyond input range of 15');
    writePng(input, 64, 64, 3, 8, values.flatMap(value => [value, value, value]));
    run('clahe', [input, output, 4, 4, 4]);
    const color = readPng(output).values;
    for (let i = 0; i < color.length; i += 3) {
        assert.ok(Math.abs(color[i] - color[i + 1]) <= 1);
        assert.ok(Math.abs(color[i] - color[i + 2]) <= 1);
    }
    assert.ok(Math.max(...color) - Math.min(...color) > 25);
});

test('morphology operations match binary-mask geometry and kernel choices', t => {
    const dir = fixture(t), input = path.join(dir, 'mask.png'), output = path.join(dir, 'out.png');
    const square = Array.from({ length: 121 }, (_, i) => {
        const x = i % 11, y = Math.floor(i / 11);
        return x >= 3 && x <= 7 && y >= 3 && y <= 7 ? 255 : 0;
    });
    writePng(input, 11, 11, 1, 8, square);
    for (const [operation, expected] of [['erode', 9], ['dilate', 49], ['open', 25], ['close', 25], ['gradient', 40]]) {
        run('morphology', [input, output, operation, 'rectangle', 3, 1]);
        const values = readPng(output).values;
        assert.equal(values.filter(value => value === 255).length, expected, operation);
        assert.ok(values.every(value => value === 0 || value === 255));
    }
    const spot = Array(121).fill(0);
    spot[60] = 255;
    writePng(input, 11, 11, 1, 8, spot);
    for (const [shape, expected] of [['rectangle', 9], ['ellipse', 5], ['cross', 5]]) {
        run('morphology', [input, output, 'dilate', shape, 3, 1]);
        assert.equal(readPng(output).values.filter(value => value === 255).length, expected);
    }
    run('morphology', [input, output, 'open', 'rectangle', 3, 1]);
    assert.ok(readPng(output).values.every(value => value === 0), 'opening removes isolated speck');
    writePng(input, 11, 11, 1, 8, square.map((value, i) => i === 60 ? 0 : value));
    run('morphology', [input, output, 'close', 'rectangle', 3, 1]);
    assert.equal(readPng(output).values[60], 255, 'closing fills central hole');
    writePng(input, 11, 11, 1, 8, spot);
    run('morphology', [input, output, 'dilate', 'rectangle', 3, 2]);
    assert.equal(readPng(output).values.filter(value => value === 255).length, 25);
});

test('filters preserve dimensions, supported depths/channels, and alpha exactly', t => {
    const dir = fixture(t), input = path.join(dir, 'in.png'), output = path.join(dir, 'out.png');
    for (const depth of [8, 16]) {
        for (const channels of [1, 3, 4]) {
            const factor = depth === 16 ? 257 : 1;
            const values = Array.from({ length: 32 * 24 * channels }, (_, i) =>
                channels === 4 && i % 4 === 3 ? (i % 256) * factor : (100 + i % 20) * factor);
            writePng(input, 32, 24, channels, depth, values);
            for (const tool of ['bilateral', 'morphology', 'clahe']) {
                if (tool === 'clahe' && depth === 16 && channels !== 1) {
                    assert.match(run(tool, [input, output], false).stderr, /color input must be 8-bit/);
                    continue;
                }
                run(tool, [input, output]);
                const result = readPng(output);
                assert.deepEqual([result.width, result.height, result.depth, result.channels], [32, 24, depth, channels]);
                if (channels === 4) {
                    for (let i = 3; i < values.length; i += 4) assert.equal(result.values[i], values[i], `${tool} alpha`);
                }
                if (depth === 16) assert.ok(result.values.some(value => value > 255), `${tool} retains 16-bit data`);
            }
        }
    }
});

test('new filters reject invalid parameters, unavailable input, and output failures', t => {
    const dir = fixture(t), input = path.join(dir, 'in.png'), output = path.join(dir, 'out.png');
    writePng(input, 32, 24, 1, 8, Array(768).fill(100));
    const bad = {
        bilateral: [[2], [33], [9, 0], [9, 'NaN'], [9, 25, -1], [9, '2bad'], [9, 25, 'inf']],
        clahe: [[0], ['NaN'], [2, 0], [2, 1.5], [2, 65], [2, 8, 25]],
        morphology: [['bad'], ['open', 'bad'], ['open', 'ellipse', 2], ['open', 'ellipse', 65],
            ['open', 'ellipse', 3, 0], ['open', 'ellipse', 3, 21]]
    };
    for (const [tool, cases] of Object.entries(bad)) {
        for (const args of cases) run(tool, [input, output, ...args], false);
        run(tool, [], false);
        run(tool, [input, output, ...Array(10).fill('1')], false);
        run(tool, [path.join(dir, 'missing.png'), output], false);
        run(tool, [input, path.join(dir, 'missing/out.png')], false);
    }
});
