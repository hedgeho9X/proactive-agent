import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("danmaku", {
  subscribe: (show: (value: unknown) => void, clear: () => void) => {
    ipcRenderer.on("danmaku:show", (_event, value) => show(value));
    ipcRenderer.on("danmaku:clear", () => clear());
  },
  painted: (id: string) => ipcRenderer.send("danmaku:painted", id),
  finished: (id: string) => ipcRenderer.send("danmaku:finished", id),
});
