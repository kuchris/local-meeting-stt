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

export type AssetStatus = {
  id: string;
  label: string;
  relativePath: string;
  exists: boolean;
};

export type AudioDevice = {
  name: string;
  id: string;
  kind: "loopback" | "mic";
};

export type AudioDeviceStatus = {
  defaultSpeaker: string;
  defaultMicrophone: string;
  loopbacks: AudioDevice[];
  microphones: AudioDevice[];
  error?: string;
};

export type OutputSession = {
  id: string;
  name: string;
  folderPath: string;
  audioPath: string;
  audioSize: number;
  modifiedTime: number;
  transcripts: {
    live: boolean;
    cppCpu: boolean;
    cppGpu: boolean;
    qwenCpu: boolean;
    qwenGpu: boolean;
  };
};

export type AppSettings = {
  outputDir?: string;
  qwen?: {
    chunkSeconds?: number;
    tokens?: number;
    batch?: number;
  };
  ui?: {
    sessionListWidth?: number;
    transcribeColumnWidth?: number;
  };
};

declare global {
  interface Window {
    meetingApi: {
      runCommand: (kind: string, args?: Record<string, unknown>) => Promise<{ processId: number; label: string }>;
      stopCommand: (processId: number) => Promise<{ stopped: boolean }>;
      pickAudioFile: () => Promise<string | null>;
      pickOutputFolder: () => Promise<string | null>;
      loadSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<{ ok: boolean; path: string }>;
      startAssetDownload: (assetId: string) => Promise<{ started: boolean; assetId: string }>;
      stopAssetDownload: (assetId: string) => Promise<{ stopped: boolean }>;
      listOutputSessions: (outputDir: string) => Promise<OutputSession[]>;
      openPath: (targetPath: string) => Promise<{ ok: boolean }>;
      checkAssets: () => Promise<AssetStatus[]>;
      listAudioDevices: () => Promise<AudioDeviceStatus>;
      windowControl: (action: "minimize" | "maximize" | "close") => Promise<{ ok: boolean }>;
      onProcessEvent: (callback: (event: ProcessEvent) => void) => () => void;
      onAssetDownloadEvent: (callback: (event: AssetDownloadEvent) => void) => () => void;
    };
  }
}
