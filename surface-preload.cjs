// Preload for the surface window: it can only ask for the image it was opened with.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('surfaceView', {
    // Resolves to { name, image } where image is a data URL, or null if the window has no payload.
    load: () => ipcRenderer.invoke('surface:payload')
});
