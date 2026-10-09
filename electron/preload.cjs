const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jsonCodex", Object.freeze({
  getState: () => ipcRenderer.invoke("state:get"),
  fetchModels: (input) => ipcRenderer.invoke("models:fetch", input),
  previewConfig: (input) => ipcRenderer.invoke("config:preview", input),
  applyConfig: (input) => ipcRenderer.invoke("config:apply", input),
  rollback: () => ipcRenderer.invoke("config:rollback"),
  openDocumentation: (url) => ipcRenderer.invoke("docs:open", url),
}));
