const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vitro', {
  load: () => ipcRenderer.invoke('state:load'),
  save: (data) => ipcRenderer.send('state:save', data),
  ready: () => ipcRenderer.send('renderer:ready'),
  onVisibility: (cb) => {
    const handler = (_event, visible) => cb(!!visible)
    ipcRenderer.on('overlay:visibility', handler)
    return () => ipcRenderer.removeListener('overlay:visibility', handler)
  },
  toggle: () => ipcRenderer.send('overlay:toggle'),
  requestHide: () => ipcRenderer.send('overlay:hide'),
  hidden: () => ipcRenderer.send('overlay:hidden'),
  setTrayTitle: (text) => ipcRenderer.send('tray:title', String(text || '')),
  notify: (payload) => ipcRenderer.send('notify', payload),
  onNotifyClick: (cb) => {
    const handler = (_event, id) => cb(id ? String(id) : null)
    ipcRenderer.on('notify:click', handler)
    return () => ipcRenderer.removeListener('notify:click', handler)
  },
})
