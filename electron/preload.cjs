const { contextBridge, ipcRenderer } = require('electron');

const invoke = (name) => (...args) => ipcRenderer.invoke(`phonegest:${name}`, ...args);

contextBridge.exposeInMainWorld('phonegest', Object.freeze({
  getAppInfo: invoke('getAppInfo'),
  loadSession: invoke('loadSession'),
  saveSession: invoke('saveSession'),
  exportPdf: invoke('exportPdf'),
  print: invoke('print'),
  exportImages: invoke('exportImages'),
  saveProject: invoke('saveProject'),
  openProject: invoke('openProject'),
  readClipboard: invoke('readClipboard'),
  getUpdateState: invoke('getUpdateState'),
  checkForUpdates: invoke('checkForUpdates'),
  downloadUpdate: invoke('downloadUpdate'),
  installUpdate: invoke('installUpdate'),
  openReleasePage: invoke('openReleasePage'),
  onUpdateState(callback) {
    if (typeof callback !== 'function') throw new TypeError('Se necesita una función para recibir las actualizaciones.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('phonegest:updateState', listener);
    return () => ipcRenderer.removeListener('phonegest:updateState', listener);
  },
}));
