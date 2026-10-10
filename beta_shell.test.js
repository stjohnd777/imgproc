import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ELEMENT_CATEGORIES, elementIconName } from './view_helpers.js';
import { renderMarkdown } from './markdown.js';

const root = import.meta.dirname;
const ICONS = new Set(['image', 'transform', 'storage', 'camera', 'file', 'folder', 'sliders', 'grid', 'edges',
    'crosshair', 'stereo', 'brain', 'chart', 'sparkle', 'branch']);
const KIND_ICONS = { source: 'image', transform: 'transform', sink: 'storage' };

test('generic transform elements take their category icon; specific icons are kept', () => {
    assert.equal(elementIconName({ kind: 'transform', category: 'ai_ml', icon: 'transform' }, ICONS, KIND_ICONS), 'brain');
    assert.equal(elementIconName({ kind: 'transform', category: 'feature' }, ICONS, KIND_ICONS), 'crosshair');
    assert.equal(elementIconName({ kind: 'source', category: 'source', icon: 'camera' }, ICONS, KIND_ICONS), 'camera');
    assert.equal(elementIconName({ kind: 'transform', category: 'filter', icon: 'transform' }, ICONS, KIND_ICONS), 'sliders');
    assert.equal(elementIconName({ kind: 'transform', category: 'unknown', icon: 'nope' }, ICONS, KIND_ICONS), 'transform');
});

test('every palette category names an icon, and every shipped element resolves to a known icon', () => {
    for (const { category, icon } of ELEMENT_CATEGORIES) assert.ok(ICONS.has(icon), `${category} → ${icon}`);
    const view = readFileSync(path.join(root, 'View.js'), 'utf8');
    for (const icon of ICONS) assert.match(view, new RegExp(`^    ${icon}: \\[`, 'm'), `View.js ICON_SHAPES lacks ${icon}`);
    for (const file of readdirSync(path.join(root, 'elements')).filter(name => name.endsWith('.json'))) {
        const spec = JSON.parse(readFileSync(path.join(root, 'elements', file), 'utf8'));
        assert.ok(ICONS.has(elementIconName(spec, ICONS, KIND_ICONS)), file);
    }
});

test('help markdown escapes HTML and renders links, lists, code and tables', () => {
    const html = renderMarkdown([
        '# Title <script>', '', 'See [the readme](Readme.md) and `a<b`.', '', '- **one**', '- two', '',
        '```sh', 'echo "<x>"', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |'
    ].join('\n'));
    assert.match(html, /<h1>Title &lt;script&gt;<\/h1>/);
    assert.match(html, /<a href="Readme.md">the readme<\/a>/);
    assert.match(html, /<code>a&lt;b<\/code>/);
    assert.match(html, /<ul><li><strong>one<\/strong><\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<pre><code>echo &quot;&lt;x&gt;&quot;<\/code><\/pre>/);
    assert.match(html, /<th>a<\/th>.*<td>2<\/td>/s);
    assert.doesNotMatch(html, /<script>/);
});

test('help.md links point at documents that exist', () => {
    const help = readFileSync(path.join(root, 'help.md'), 'utf8');
    const links = [...help.matchAll(/\]\(([^)]+\.md)\)/g)].map(match => match[1]);
    assert.ok(links.length >= 4);
    for (const link of links) assert.ok(existsSync(path.join(root, link)), link);
});

test('package metadata and packaging config are branded and point at real resources', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.productName, 'Orbital Eyes');
    assert.notEqual(pkg.name, 'hello-world');
    assert.match(pkg.scripts.test, /node --test/);
    assert.match(pkg.scripts.dev, /--dev/);
    assert.ok(existsSync(path.join(root, pkg.build.mac.icon)));
    assert.ok(existsSync(path.join(root, pkg.build.mac.entitlements)));
    assert.ok(existsSync(path.join(root, pkg.build.win.icon)));
    assert.ok(existsSync(path.join(root, pkg.build.linux.icon)));
    assert.ok(pkg.build.files.includes('native/**/*'));
    assert.match(pkg.scripts.prepack, /verify:native/);
    assert.match(pkg.scripts.predist, /verify:native/);
    for (const page of ['splash.html', 'about.html', 'help.html', 'assets/logo.svg']) assert.ok(existsSync(path.join(root, page)), page);
});
