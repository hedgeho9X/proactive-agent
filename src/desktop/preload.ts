import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("proactive", {
  invoke: (method: string, params: unknown = {}) =>
    ipcRenderer.invoke("proactive:invoke", method, params),
  subscribe: (listener: () => void) => {
    const fn = () => listener();
    ipcRenderer.on("proactive:event", fn);
    return () => ipcRenderer.removeListener("proactive:event", fn);
  },
  onWindowBlur: (listener: () => void) => {
    const fn = () => listener();
    ipcRenderer.on("proactive:window-blur", fn);
    return () => ipcRenderer.removeListener("proactive:window-blur", fn);
  },
});
