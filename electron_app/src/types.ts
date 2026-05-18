export type ProcessEvent =
  | { type: "start"; processId: number; label: string; command: string }
  | { type: "stdout"; processId: number; text: string }
  | { type: "stderr"; processId: number; text: string }
  | { type: "exit"; processId: number; code: number | null; signal: string | null };

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

declare global {
  interface Window {
    meetingApi: {
      runCommand: (kind: string, args?: Record<string, unknown>) => Promise<{ processId: number; label: string }>;
      stopCommand: (processId: number) => Promise<{ stopped: boolean }>;
      pickAudioFile: () => Promise<string | null>;
      pickOutputFolder: () => Promise<string | null>;
      openPath: (targetPath: string) => Promise<{ ok: boolean }>;
      checkAssets: () => Promise<AssetStatus[]>;
      listAudioDevices: () => Promise<AudioDeviceStatus>;
      windowControl: (action: "minimize" | "maximize" | "close") => Promise<{ ok: boolean }>;
      onProcessEvent: (callback: (event: ProcessEvent) => void) => () => void;
    };
  }
}
