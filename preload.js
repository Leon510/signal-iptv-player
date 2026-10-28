const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  loadChannels: (id) => ipcRenderer.invoke('channels:load', id),
  saveChannels: (id, data) => ipcRenderer.invoke('channels:save', id, data),
  deleteChannels: (id) => ipcRenderer.invoke('channels:delete', id),
  fetchPlaylist: (url) => ipcRenderer.invoke('playlist:fetch', url),
  pickFile: () => ipcRenderer.invoke('playlist:pickFile'),
  readFile: (file) => ipcRenderer.invoke('playlist:readFile', file),
  setUserAgent: (ua) => ipcRenderer.invoke('net:setUserAgent', ua),
  fullscreen: (value) => ipcRenderer.invoke('window:fullscreen', value),
  openInVlc: (url, title, lang) => ipcRenderer.invoke('external:vlc', url, title, lang),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
  loadEpg: (id) => ipcRenderer.invoke('epg:load', id),
  updateEpg: (id, url, want) => ipcRenderer.invoke('epg:update', id, url, want),
  deleteEpg: (id) => ipcRenderer.invoke('epg:delete', id),
  mini: (on) => ipcRenderer.invoke('window:mini', on),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
