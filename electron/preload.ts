import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  storeApiKey: (name: string, value: string) =>
    ipcRenderer.invoke("store-api-key", name, value),
  loadApiKey: (name: string) => ipcRenderer.invoke("load-api-key", name),
  hasAnyApiKey: () => ipcRenderer.invoke("has-any-api-key"),
  completeSetup: () => ipcRenderer.send("api-key-setup-complete"),
});
