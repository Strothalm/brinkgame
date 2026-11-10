// Narrow bridge between the page and the main process. The page gets no Node access.
const { contextBridge, ipcRenderer } = require('electron');

let acListener = null;

contextBridge.exposeInMainWorld('brink', {
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    quit: () => ipcRenderer.send('app:quit'),
    toggleFullscreen: () => ipcRenderer.send('app:fullscreen'),
  },
  ac: {
    start: () => ipcRenderer.send('ac:start'),
    stop: () => ipcRenderer.send('ac:stop'),
    onData: (fn) => {
      if (acListener) ipcRenderer.removeListener('ac:data', acListener);
      acListener = (e, data) => fn(data);
      ipcRenderer.on('ac:data', acListener);
    },
  },
});
