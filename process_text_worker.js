import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';

try {
    const script = new vm.Script(`
        "use strict";
        (() => {
            ${workerData.code}
            if (typeof process !== 'function') throw new Error('Define function process(objIn)');
            const result = process(JSON.parse(${JSON.stringify(workerData.input)}));
            const ancestors = new Set();
            function validate(value) {
                if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
                if (typeof value === 'number' && Number.isFinite(value)) return;
                if (typeof value !== 'object') throw new Error('Return only JSON values; undefined, functions, BigInt and non-finite numbers are not supported');
                if (typeof value.then === 'function') throw new Error('process(objIn) must be synchronous; Promises are not supported');
                if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
                    throw new Error('Return plain JSON objects or arrays');
                }
                if (ancestors.has(value)) throw new Error('Return value contains a circular reference');
                ancestors.add(value);
                if (Array.isArray(value)) {
                    for (const item of value) validate(item);
                } else {
                    for (const key of Reflect.ownKeys(value)) {
                        if (typeof key !== 'string') throw new Error('JSON objects cannot have symbol keys');
                        validate(value[key]);
                    }
                }
                ancestors.delete(value);
            }
            validate(result);
            return JSON.stringify(result, null, 2);
        })()
    `, { filename: 'process_text.user.js' });
    const context = vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false },
        microtaskMode: 'afterEvaluate'
    });
    const output = script.runInContext(context, { timeout: 1000 });
    if (typeof output !== 'string') throw new Error('process(objIn) must return a JSON value');
    if (Buffer.byteLength(output, 'utf8') > workerData.maxBytes) throw new Error('JSON output exceeds the 5 MB limit');
    parentPort.postMessage({ output: `${output}\n` });
} catch (error) {
    parentPort.postMessage({ error: error.message });
}
