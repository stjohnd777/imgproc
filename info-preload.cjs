const { contextBridge, ipcRenderer } = require('electron');

// Shared by the About and Help windows.
contextBridge.exposeInMainWorld('appInfo', {
    about: () => ipcRenderer.invoke('app:about'),
    openDoc: relativePath => ipcRenderer.invoke('app:openDoc', relativePath)
});
