'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cijian', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  planVerify: () => ipcRenderer.invoke('plan:verify'),
  exportData: (payload) => ipcRenderer.invoke('data:export', payload),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  },
});
