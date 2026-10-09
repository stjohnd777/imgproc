// Workflow frame indexes are zero-based; displayed frame numbers are one-based.
export function renderArgs(template, { inputs, outputs, params, frameIndex }) {
    return template.map(item => {
        if (item === '{frame.index}') {
            if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex > 2147483647) {
                throw new Error('A valid frame index is required for this tool.');
            }
            return String(frameIndex);
        }
        const fallback = /^\{in\.([\w-]+)\|param\.([\w-]+)\}$/.exec(item);
        if (fallback) return String(inputs[fallback[1]] || params[fallback[2]] || '');
        const match = /^\{(in|out|param)\.([\w-]+)\}$/.exec(item);
        if (!match) return item;
        const [, kind, key] = match;
        const value = kind === 'in' ? inputs[key] : kind === 'out' ? outputs[key] : params[key];
        if (value === undefined || value === null) return '';
        if (typeof value === 'boolean') return value ? '1' : '0';
        return String(value);
    });
}
