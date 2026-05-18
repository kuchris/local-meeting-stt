import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("meetingApi", {
  runCommand: (kind: string, args?: Record<string, unknown>) => ipcRenderer.invoke("run-command", kind, args ?? {}),
  stopCommand: (processId: number) => ipcRenderer.invoke("stop-command", processId),
  pickAudioFile: () => ipcRenderer.invoke("pick-audio-file"),
  pickOutputFolder: () => ipcRenderer.invoke("pick-output-folder"),
  openPath: (targetPath: string) => ipcRenderer.invoke("open-path", targetPath),
  checkAssets: () => ipcRenderer.invoke("check-assets"),
  listAudioDevices: () => ipcRenderer.invoke("list-audio-devices"),
  windowControl: (action: string) => ipcRenderer.invoke("window-control", action),
  onProcessEvent: (callback: (event: ProcessEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: ProcessEvent) => callback(event);
    ipcRenderer.on("process-event", listener);
    return () => ipcRenderer.removeListener("process-event", listener);
  }
});

export type ProcessEvent =
  | { type: "start"; processId: number; label: string; command: string }
  | { type: "stdout"; processId: number; text: string }
  | { type: "stderr"; processId: number; text: string }
  | { type: "exit"; processId: number; code: number | null; signal: string | null };
