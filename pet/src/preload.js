const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  move: (x, y) => ipcRenderer.send('pet:move', x, y),
  getPanelPosition: () => ipcRenderer.invoke('pet:get-panel-position'),
  movePanel: (x, y) => ipcRenderer.send('panel:move', x, y),
  togglePanel: () => ipcRenderer.send('pet:toggle-panel'),
  closePanel: () => ipcRenderer.send('pet:close-panel'),
  getInfo: () => ipcRenderer.invoke('pet:get-info'),
  onRefresh: (cb) => ipcRenderer.on('panel:refresh', () => cb()),
  // —— 对话窗 ——
  toggleChat: () => ipcRenderer.send('pet:toggle-chat'),
  closeChat: () => ipcRenderer.send('chat:close'),
  getChatPosition: () => ipcRenderer.invoke('chat:get-position'),
  moveChat: (x, y) => ipcRenderer.send('chat:move', x, y),
  chatSend: (messages) => ipcRenderer.invoke('chat:send', messages),
  screenshot: () => ipcRenderer.invoke('chat:screenshot'),
  openDsh: () => ipcRenderer.invoke('chat:open-dsh'),
  onChatFocus: (cb) => ipcRenderer.on('chat:focus', () => cb()),
});
