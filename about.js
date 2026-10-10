const cell = (row, text, className) => {
    const td = row.insertCell();
    td.textContent = text;
    if (className) td.className = className;
};
window.appInfo.about().then(info => {
    document.getElementById('version').textContent = `Version ${info.version}`;
    const facts = document.getElementById('facts');
    for (const [label, value] of [
        ['Build date', new Date(info.buildDate).toLocaleString()],
        ['OpenCV', info.opencv],
        ['Electron', `${info.electron} (Chromium ${info.chrome}, Node ${info.node})`],
        ['Platform', info.platform],
        ['Settings', info.settingsFiles.join('\n')]
    ]) {
        const row = facts.insertRow();
        cell(row, label);
        cell(row, value);
    }
    const external = document.getElementById('external');
    for (const [label, tool] of Object.entries(info.external)) {
        const row = external.insertRow();
        cell(row, label);
        const status = tool.found === null ? '(looked up on PATH)' : tool.found ? '✓' : '✗ not found';
        cell(row, `${tool.path} ${status}`, tool.found === false ? 'bad' : tool.found ? 'ok' : '');
    }
    document.getElementById('toolsTitle').textContent = `Native tools (${info.nativeTools.length} built)`;
    const list = document.getElementById('tools');
    for (const tool of info.nativeTools) {
        const item = document.createElement('li');
        item.textContent = tool.name;
        item.title = `${tool.project} · built ${new Date(tool.built).toLocaleString()}`;
        list.append(item);
    }
}).catch(err => { document.body.append(`Could not read app details: ${err.message}`); });
