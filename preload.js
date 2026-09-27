'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cijian', {
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),
  planVerify: () => ipcRenderer.invoke('plan:verify'),
  exportData: (payload) => ipcRenderer.invoke('data:export', payload),
  /** 选一张背景图片或视频。主进程会把文件复制进 userData/background/，
      只回传文件名 —— 渲染进程拿不到、也不需要真实路径。 */
  pickBackground: () => ipcRenderer.invoke('background:pick'),
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
