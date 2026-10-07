import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCli } from './cli_process.js';
import { appendLog } from './tab_console.js';
import { Controller, LocalRunner } from './Controller.js';
import { TabModel } from './Data.js';

test('CLI stdout/stderr stream before exit; successful stderr is not a failure', async () => {
    const entries = [];
    let finished = false;
    let firstOutput;
    const outputArrived = new Promise(resolve => { firstOutput = resolve; });
    const execution = executeCli(process.execPath, ['-e',
        "process.stdout.write('first\\n'); process.stderr.write('warning\\n'); setTimeout(()=>process.stdout.write('last\\n'),200)"
    ], { timeout: 2000 }, entry => {
        entries.push(entry);
        if (entry.stream === 'stdout' && entry.text.includes('first')) firstOutput();
    }, 'Test tool').then(result => { finished = true; return result; });
    await outputArrived;
    assert.equal(finished, false, 'output must arrive before process completion');
    await execution;
    assert.ok(entries.some(entry => entry.stream === 'stdout' && entry.text.includes('first')));
    assert.ok(entries.some(entry => entry.stream === 'stderr' && entry.text.includes('warning')));
    assert.equal(entries.at(-1).stream, 'system');
    assert.match(entries.at(-1).text, /exit 0.*ms/);
});

test('CLI errors and timeout produce explicit error log entries', async () => {
    for (const [code, timeout] of [
        ["process.stderr.write('bad input');process.exit(3)", 2000],
        ['setTimeout(()=>{},1000)', 50]
    ]) {
        const entries = [];
        await assert.rejects(executeCli(process.execPath, ['-e', code], { timeout },
            entry => entries.push(entry), 'Failing tool'));
        assert.equal(entries.at(-1).stream, 'error');
        assert.match(entries.at(-1).text, /Failed/);
    }
});

test('tab logs are bounded, preserve stream labels, and expand only on failure', () => {
    const tab = {};
    appendLog(tab, { label: 'Blender', stream: 'stderr', text: 'warning' });
    assert.equal(tab.console.expanded, false);
    assert.match(tab.console.text, /Blender · stderr.*warning/);
    appendLog(tab, { label: 'CLI', stream: 'stdout', text: 'x'.repeat(300000) });
    assert.equal(tab.console.text.length, 200000);
    assert.ok(tab.console.text.startsWith('[Older output discarded]'));
    appendLog(tab, { label: 'CLI', stream: 'error', text: 'exit 3' });
    assert.equal(tab.console.expanded, true);
});

test('stream routing stays with initiating tab despite active tab changes; toolbar supplies ID', async t => {
    const previous = globalThis.window;
    t.after(() => { globalThis.window = previous; });
    let listener, request;
    globalThis.window = {
        tabConsole: { onLog(callback) { listener = callback; } },
        vision: { async run(...args) { request = args; return {}; } }
    };
    const model = new TabModel();
    const origin = model.addTab({ label: 'Origin', path: '/a.png' });
    const other = model.addTab({ label: 'Other', path: '/b.png' });
    new Controller(model, { refreshConsole() {} }, null, {});
    listener({ tabId: origin, label: 'Sobel', stream: 'stdout', text: 'result' });
    assert.equal(model.getActiveTab().id, other);
    assert.match(model.getTab(origin).console.text, /result/);
    assert.equal(model.getTab(other).console, undefined);
    await new LocalRunner().run(model.getTab(origin), 'SOBEL X', {});
    assert.equal(request[3], origin);
    model.closeTab(origin);
    assert.doesNotThrow(() => listener({ tabId: origin, text: 'closed' }));
});
