/** Existing launch paths only. This catalog does not install or replace models. */
export const liveModes = [
  {
    id: "live-meeting",
    model: "small",
    label: "faster-whisper",
    capture: true,
    optionalWav: true,
    assets: ["faster-whisper"],
  },
  {
    id: "live-cpp-gpu",
    model: "small",
    label: "whisper.cpp · CUDA（會議期間常駐）",
    capture: true,
    optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-cuda"],
  },
  {
    id: "live-cpp-cpu",
    model: "small",
    label: "whisper.cpp · CPU（會議期間常駐）",
    capture: true,
    optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-cpu"],
  },
  {
    id: "live-cpp-server-vulkan",
    model: "small",
    label: "whisper.cpp · Vulkan",
    capture: true,
    optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-vulkan"],
  },
  {
    id: "live-cpp-server-openvino",
    model: "small",
    label: "OpenVINO · NPU",
    capture: true,
    optionalWav: false,
    assets: [
      "whisper-cpp-model",
      "whisper-cpp-openvino",
      "whisper-cpp-openvino-model-xml",
      "whisper-cpp-openvino-model-bin",
    ],
  },
  {
    id: "live-cpp-server-openvino-gpu",
    model: "small",
    label: "OpenVINO · GPU",
    capture: true,
    optionalWav: false,
    assets: [
      "whisper-cpp-model",
      "whisper-cpp-openvino",
      "whisper-cpp-openvino-model-xml",
      "whisper-cpp-openvino-model-bin",
    ],
  },
  {
    id: "live-cpp-stream-loopback-small",
    model: "small",
    label: "Vulkan loopback",
    capture: false,
    optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-vulkan-loopback"],
  },
  {
    id: "live-cpp-stream-loopback-base",
    model: "base",
    label: "Vulkan loopback",
    capture: false,
    optionalWav: false,
    assets: ["whisper-cpp-base-model", "whisper-cpp-vulkan-loopback"],
  },
] as const;

export type JobPhase =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "complete"
  | "error";
export const phaseLabels: Record<JobPhase, string> = {
  idle: "準備就緒",
  starting: "正在啟動",
  running: "執行中",
  stopping: "正在停止",
  stopped: "已停止",
  complete: "已完成",
  error: "執行失敗",
};
