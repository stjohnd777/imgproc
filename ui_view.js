export function uiViewResult(step, inputs, type = 'image') {
    const port = type === 'text' ? 'text' : 'image';
    if (!inputs[port]) throw new Error(`${step.name} has no ${port} to view.`);
    return {
        nodeId: step.nodeId,
        name: step.name,
        order: step.order,
        ms: 0,
        output: inputs[port],
        uiView: true,
        reuseTab: step.params?.reuse_tab ?? true,
        artifacts: [{ port, type, path: inputs[port] }]
    };
}
