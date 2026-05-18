import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("meetingApi", {
  runCommand: (kind: string, args?: Record<string, unknown>) => ipcRenderer.invoke("run-command", kind, args ?? {}),
  stopCommand: (processId: number) => ipcRenderer.invoke("stop-command", processId),
  pickAudioFile: () => ipcRenderer.invoke("pick-audio-file"),
  pickOutputFolder: () => ipcRenderer.invoke("pick-output-folder"),
  loadSettings: () => ipcRenderer.invoke("load-settings"),
  saveSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke("save-settings", settings),
  startAssetDownload: (assetId: string) => ipcRenderer.invoke("start-asset-download", assetId),
  stopAssetDownload: (assetId: string) => ipcRenderer.invoke("stop-asset-download", assetId),
  listOutputSessions: (outputDir: string) => ipcRenderer.invoke("list-output-sessions", outputDir),
  openPath: (targetPath: string) => ipcRenderer.invoke("open-path", targetPath),
  checkAssets: () => ipcRenderer.invoke("check-assets"),
  listAudioDevices: () => ipcRenderer.invoke("list-audio-devices"),
  windowControl: (action: string) => ipcRenderer.invoke("window-control", action),
  onProcessEvent: (callback: (event: ProcessEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: ProcessEvent) => callback(event);
    ipcRenderer.on("process-event", listener);
    return () => ipcRenderer.removeListener("process-event", listener);
  },
  onAssetDownloadEvent: (callback: (event: AssetDownloadEvent) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: AssetDownloadEvent) => callback(event);
    ipcRenderer.on("asset-download-event", listener);
    return () => ipcRenderer.removeListener("asset-download-event", listener);
  }
});

export type ProcessEvent =
  | { type: "start"; processId: number; label: string; command: string }
  | { type: "stdout"; processId: number; text: string }
  | { type: "stderr"; processId: number; text: string }
  | { type: "exit"; processId: number; code: number | null; signal: string | null };

export type AssetDownloadEvent =
  | { type: "start"; assetId: string; label: string }
  | { type: "progress"; assetId: string; percent: number; text: string }
  | { type: "stdout"; assetId: string; text: string }
  | { type: "stderr"; assetId: string; text: string }
  | { type: "exit"; assetId: string; code: number | null; signal: string | null };
