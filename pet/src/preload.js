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
  chatSend: (text, sessionId) => ipcRenderer.send('chat:send', text, sessionId),
  chatAskImage: (dataUrl, text) => ipcRenderer.invoke('chat:ask-image', dataUrl, text),
  screenshot: () => ipcRenderer.invoke('chat:screenshot'),
  openDsh: () => ipcRenderer.invoke('chat:open-dsh'),
  onChatFocus: (cb) => ipcRenderer.on('chat:focus', () => cb()),
  onChatToken: (cb) => ipcRenderer.on('chat:token', (_e, t) => cb(t)),
  onChatDone: (cb) => ipcRenderer.on('chat:done', (_e, d) => cb(d)),
  // 右键菜单 + 窗口缩放
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  resizePanel: (w, h) => ipcRenderer.send('panel:resize', w, h),
  getPanelSize: () => ipcRenderer.invoke('panel:get-size'),
  resizeChat: (w, h) => ipcRenderer.send('chat:resize', w, h),
  getChatSize: () => ipcRenderer.invoke('chat:get-size'),
});
