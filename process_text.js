import { Worker } from 'node:worker_threads';
import { readFile, stat, writeFile } from 'node:fs/promises';

const MAX_BYTES = 5 * 1024 * 1024;

export async function processJsonText(input, code) {
    if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_BYTES) {
        throw new Error('JSON input must be text within the 5 MB limit');
    }
    if (typeof code !== 'string' || !code.trim() || Buffer.byteLength(code, 'utf8') > 100 * 1024) {
        throw new Error('Provide a JavaScript function within the 100 KB limit');
    }
    JSON.parse(input);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./process_text_worker.js', import.meta.url), {
            workerData: { input, code, maxBytes: MAX_BYTES },
            resourceLimits: { maxOldGenerationSizeMb: 128 },
            execArgv: []
        });
        let settled = false;
        const finish = (error, output) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            void worker.terminate();
            if (error) reject(error);
            else resolve(output);
        };
        const timer = setTimeout(() => finish(new Error('Process Text exceeded its 1-second execution limit')), 1000);
        worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.output));
        worker.once('error', error => finish(error));
        worker.once('exit', code => finish(new Error(`Process Text worker exited without a result (exit ${code})`)));
    });
}

export async function processTextFile({ input, output, code, label = 'Process Text', log = () => {} }) {
    log({ label, stream: 'system', text: 'Started JSON transformation\n' });
    try {
        if (!input || !output) throw new Error('Process Text requires text input and output paths');
        const info = await stat(input);
        if (!info.isFile() || info.size > MAX_BYTES) throw new Error('JSON input must be a regular file within the 5 MB limit');
        const result = await processJsonText(await readFile(input, 'utf8'), code);
        await writeFile(output, result);
        log({ label, stream: 'system', text: 'Completed JSON transformation\n' });
    } catch (error) {
        log({ label, stream: 'error', text: `Failed: ${error.message}\n` });
        throw new Error(`${label}: ${error.message}`, { cause: error });
    }
}
