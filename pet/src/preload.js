const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  togglePanel: () => ipcRenderer.send('pet:toggle-panel'),
  closePanel: () => ipcRenderer.send('pet:close-panel'),
  getInfo: () => ipcRenderer.invoke('pet:get-info'),
  onRefresh: (cb) => ipcRenderer.on('panel:refresh', () => cb()),
});
