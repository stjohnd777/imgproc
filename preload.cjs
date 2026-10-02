// Preload runs with a tiny, trusted API surface; this is the ONLY way the page reaches the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vision', {
    run: (action, imagePath, params) => ipcRenderer.invoke('vision:run', action, imagePath, params),
    // Parameter declarations per action, used to build the dialogs. Resolves to { action: [spec] }.
    actions: () => ipcRenderer.invoke('vision:actions'),
    // Opens a separate window plotting the image's intensity as a 3D surface.
    surface: imagePath => ipcRenderer.invoke('surface:open', imagePath)
});

contextBridge.exposeInMainWorld('explorer', {
    // Resolves to { folder, name, files: [{ name, path, url }] }, or null if the dialog was cancelled.
    openFolder: () => ipcRenderer.invoke('explorer:openFolder'),
    // Folder picker for workflow parameters. Resolves to { folder, name } or null.
    chooseFolder: options => ipcRenderer.invoke('explorer:chooseFolder', options),
    // Image picker for workflow parameters. Resolves to { file, name } or null.
    chooseFile: options => ipcRenderer.invoke('explorer:chooseFile', options)
});

contextBridge.exposeInMainWorld('specs', {
    // kind is 'cameras' or 'algorithms'; any other name is rejected by the main process.
    // Resolves to [{ file, spec }] (or { file, error } for a file that isn't valid JSON).
    list: kind => ipcRenderer.invoke('specs:list', kind),
    // Reads raw JSON spec file from camera_spec/ or algo_spec/. Resolves to { path, file, content }.
    read: (kind, file) => ipcRenderer.invoke('specs:read', kind, file),
    // Saves raw JSON content back to camera_spec/ or algo_spec/. Validates JSON syntax before writing.
    save: (kind, file, content) => ipcRenderer.invoke('specs:save', kind, file, content)
});

contextBridge.exposeInMainWorld('results', {
    // Lists the runs folder from app.json as a tree, same shape as explorer.openFolder.
    list: () => ipcRenderer.invoke('results:list')
});

contextBridge.exposeInMainWorld('workflow', {
    // Works out execution order and the file each step will write, without running anything.
    // Resolves to { runnable, problems, runDir, steps }.
    prepareRun: request => ipcRenderer.invoke('workflow:prepareRun', request),
    // Runs the graph frame by frame. Resolves to { runDir, frames, late, stopped }.
    run: request => ipcRenderer.invoke('workflow:run', request),
    stop: () => ipcRenderer.invoke('workflow:stop'),
    open: () => ipcRenderer.invoke('workflow:open'),
    save: (filePath, document) => ipcRenderer.invoke('workflow:save', filePath, document),
    saveAs: document => ipcRenderer.invoke('workflow:saveAs', document),
    // Progress events. `on` returns a function that removes the listener.
    on: (event, handler) => {
        const allowed = ['started', 'frame', 'finished', 'failed', 'step'];
        if (!allowed.includes(event)) throw new Error(`Unknown workflow event: ${event}`);
        const channel = `workflow:${event}`;
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    }
});
