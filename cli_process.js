import { execFile } from 'node:child_process';

export function executeCli(executable, args, options = {}, log = () => {}, label = executable) {
    log({ label, stream: 'system', text: 'Started\n' });
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const child = execFile(executable, args, options, (error, stdout, stderr) => {
            log({
                label, stream: error ? 'error' : 'system',
                text: `${error ? `Failed (${error.code ?? error.signal ?? 'unknown'}): ${error.message}` : 'Completed (exit 0)'} · ${Date.now() - started} ms\n`
            });
            if (error) { error.stderr = stderr; reject(error); }
            else resolve({ stdout, stderr });
        });
        child.stdout?.on('data', text => log({ label, stream: 'stdout', text: String(text) }));
        child.stderr?.on('data', text => log({ label, stream: 'stderr', text: String(text) }));
    });
}
