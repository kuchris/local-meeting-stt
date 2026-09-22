import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AppSettings,
  AssetDownloadEvent,
  AssetStatus,
  AudioDeviceStatus,
  OutputSession,
  ProcessEvent,
} from "./types";
import "./styles.css";
import { liveModes, phaseLabels, type JobPhase } from "./liveModes";
import {
  DEFAULT_LOCALE,
  isLocale,
  locales,
  localeNames,
  translate,
  translateError,
  type Locale,
} from "./i18n";
import { isPostKind, switchPostModel } from "./postPreferences";

type Tab = "live" | "record" | "transcribe" | "setup";

type LogLine = {
  id: number;
  processId: number;
  kind: "info" | "stdout" | "stderr" | "exit";
  text: string;
};

type MenuName = "file" | "run" | "view" | "window" | "help";
type AssetDownloadState = {
  running: boolean;
  percent: number;
  text: string;
  exitCode?: number | null;
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "live", label: "即時會議" },
  { id: "record", label: "只錄音" },
  { id: "transcribe", label: "錄音與逐字稿" },
  { id: "setup", label: "設定與模型" },
];

function TabIcon({ tab }: { tab: Tab }) {
  if (tab === "live") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M7.6 18.2a8 8 0 0 1 0-12.4" />
        <path d="M16.4 5.8a8 8 0 0 1 0 12.4" />
      </svg>
    );
  }
  if (tab === "record") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 15.5a4.5 4.5 0 0 0 4.5-4.5V7a4.5 4.5 0 0 0-9 0v4a4.5 4.5 0 0 0 4.5 4.5Z" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    );
  }
  if (tab === "transcribe") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5h7l3 3V20.5H7V3.5Z" />
        <path d="M14 3.5v3h3" />
        <path d="M9.5 11h5" />
        <path d="M9.5 14h5" />
        <path d="M9.5 17h3.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M12 3.5v2" />
      <path d="M12 18.5v2" />
      <path d="M4.6 7.5l1.7 1" />
      <path d="M17.7 15.5l1.7 1" />
      <path d="M19.4 7.5l-1.7 1" />
      <path d="M6.3 15.5l-1.7 1" />
    </svg>
  );
}

function OutputActionIcon({ action }: { action: "choose" | "open" | "reset" }) {
  if (action === "choose") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15V6.5Z" />
        <path d="M3.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h4.5l2 2h7a1.5 1.5 0 0 1 1.5 1.5v1.5" />
        <path d="M12 12.5v5" />
        <path d="M9.5 15h5" />
      </svg>
    );
  }
  if (action === "open") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15V6.5Z" />
        <path d="M13.5 13.5h4v4" />
        <path d="M11.5 19.5l6-6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8.5a6.5 6.5 0 1 1-1.2 8" />
      <path d="M7 4.5v4h-4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4.5v9" />
      <path d="M8.5 10.5 12 14l3.5-3.5" />
      <path d="M5 18.5h14" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 5.5v13" />
      <path d="M15.5 5.5v13" />
    </svg>
  );
}

function AudioFileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3.5h7l3 3v14H7V3.5Z" />
      <path d="M14 3.5v3h3" />
      <path d="M10 15.5v-4l4 2-4 2Z" />
    </svg>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(locale, key, values);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const [jobPhase, setJobPhase] = useState<JobPhase>("idle");
  const [jobError, setJobError] = useState("");
  const [liveModeId, setLiveModeId] = useState<string>("live-meeting");
  const [saveWav, setSaveWav] = useState(true);
  const [followTranscript, setFollowTranscript] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [postKind, setPostKind] = useState("cpp-cpu");
  const [timedRecording, setTimedRecording] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const activeProcessRef = useRef<number | null>(null);
  const launchPendingRef = useRef(false);
  const stoppingRef = useRef<number | null>(null);
  const lastErrorRef = useRef("");
  const savedSettingsRef = useRef<AppSettings>({});
  const [tab, setTab] = useState<Tab>("live");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [activeProcessId, setActiveProcessId] = useState<number | null>(null);
  const [audioPath, setAudioPath] = useState("");
  const [chunkSeconds, setChunkSeconds] = useState(3);
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [qwenChunkSeconds, setQwenChunkSeconds] = useState(60);
  const [qwenTokens, setQwenTokens] = useState(4096);
  const [qwenBatch, setQwenBatch] = useState(4);
  const [systemDevice, setSystemDevice] = useState("");
  const [includeMic, setIncludeMic] = useState(false);
  const [micDevice, setMicDevice] = useState("");
  const [audioDevices, setAudioDevices] = useState<AudioDeviceStatus | null>(
    null,
  );
  const [assets, setAssets] = useState<AssetStatus[]>([]);
  const [assetDownloads, setAssetDownloads] = useState<
    Record<string, AssetDownloadState>
  >({});
  const [lastOutputPath, setLastOutputPath] = useState("");
  const [outputDir, setOutputDir] = useState(
    () => localStorage.getItem("meetingOutputDir") || "outputs",
  );
  const outputDirRef = useRef(outputDir);
  outputDirRef.current = outputDir;
  const [sessions, setSessions] = useState<OutputSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [livePreviewHistory, setLivePreviewHistory] = useState("");
  const [livePartialTranscript, setLivePartialTranscript] = useState("");
  const [liveTranscriptPath, setLiveTranscriptPath] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sessionListWidth, setSessionListWidth] = useState(
    () => Number(localStorage.getItem("meetingSessionListWidth")) || 300,
  );
  const [transcribeLibraryWidth, setTranscribeLibraryWidth] = useState(0);
  const transcribeLibraryRef = useRef<HTMLElement | null>(null);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const activeLabelRef = useRef("");
  const lbStreamRef = useRef({ running: "", committedTail: "" });

  const isRunning =
    activeProcessId !== null ||
    jobPhase === "starting" ||
    jobPhase === "stopping";
  const liveMode =
    liveModes.find((mode) => mode.id === liveModeId) ?? liveModes[0];
  const missingAssets = assets.filter(
    (asset) =>
      (liveMode.assets as readonly string[]).includes(asset.id) &&
      !asset.exists,
  );
  const liveUnavailable =
    !assetsLoaded ||
    liveMode.assets.some(
      (id) => !assets.some((asset) => asset.id === id && asset.exists),
    );
  const captureSupported = tab !== "live" || liveMode.capture;
  const selectedSpeaker = systemDevice
    ? audioDevices?.loopbacks.find(
        (device) => (device.id || device.name) === systemDevice,
      )?.name || t("裝置未連接")
    : audioDevices?.defaultSpeaker || t("系統預設音源");
  const selectedMic = micDevice
    ? audioDevices?.microphones.find(
        (device) => (device.id || device.name) === micDevice,
      )?.name || t("裝置未連接")
    : audioDevices?.defaultMicrophone || t("預設麥克風");
  const selectedSession =
    sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedAudioPath = selectedSession?.audioPath || audioPath;
  const elapsedSeconds = startedAt
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0;
  const effectiveSessionListWidth = clampSessionListWidth(
    sessionListWidth,
    transcribeLibraryWidth,
  );

  useEffect(() => {
    const unsubscribe = window.meetingApi.onProcessEvent((event) => {
      handleProcessEvent(event);
    });
    const unsubscribeAssetDownloads = window.meetingApi.onAssetDownloadEvent(
      (event) => {
        handleAssetDownloadEvent(event);
      },
    );
    void loadSettings();
    void refreshAssets();
    void refreshAudioDevices();
    void refreshSessions();
    return () => {
      unsubscribe();
      unsubscribeAssetDownloads();
    };
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [outputDir]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    const logsElement = logsRef.current;
    if (logsElement) logsElement.scrollTop = logsElement.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const outputElement = outputRef.current;
    if (outputElement && followTranscript)
      outputElement.scrollTop = outputElement.scrollHeight;
  }, [
    liveTranscript,
    livePreviewHistory,
    livePartialTranscript,
    lastOutputPath,
    tab,
    followTranscript,
  ]);

  useEffect(() => {
    const element = transcribeLibraryRef.current;
    if (!element) return;
    const observedElement = element;

    function updateWidth() {
      setTranscribeLibraryWidth(observedElement.getBoundingClientRect().width);
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(observedElement);
    return () => observer.disconnect();
  }, [tab]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const settings: AppSettings = {
      ...savedSettingsRef.current,
      outputDir,
      capture: { systemDevice, micDevice, includeMic },
      live: { mode: liveModeId, saveWav, chunkSeconds },
      post: { kind: postKind },
      qwen: {
        chunkSeconds: qwenChunkSeconds,
        tokens: qwenTokens,
        batch: qwenBatch,
      },
      ui: {
        ...savedSettingsRef.current.ui,
        locale,
        sessionListWidth,
      },
    };
    localStorage.setItem("meetingOutputDir", outputDir);
    localStorage.setItem("meetingSessionListWidth", String(sessionListWidth));
    void window.meetingApi
      .saveSettings(settings)
      .catch((error) => setJobError(`設定未能儲存：${String(error)}`));
  }, [
    outputDir,
    qwenChunkSeconds,
    qwenTokens,
    qwenBatch,
    sessionListWidth,
    settingsLoaded,
    systemDevice,
    micDevice,
    includeMic,
    liveModeId,
    saveWav,
    chunkSeconds,
    postKind,
    locale,
  ]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void pickAudio();
        setTab("transcribe");
      }
      if (event.key === "Escape") setOpenMenu(null);
      if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const lineTimestampPattern = /^\[\d{2}:\d{2}:\d{2}\]\s*/;

  function currentClockStamp() {
    return new Date().toLocaleTimeString("en-GB", { hour12: false });
  }

  function stripLineTimestamp(text: string) {
    return text.replace(lineTimestampPattern, "");
  }

  function withLineTimestamp(line: string, stamp = currentClockStamp()) {
    const value = normalizeJapaneseSpacing(line);
    if (!value) return "";
    if (lineTimestampPattern.test(value)) return value;
    return `[${stamp}] ${value}`;
  }

  function timestampMultiline(text: string) {
    const stamp = currentClockStamp();
    return text
      .split(/\r?\n/)
      .map((line) => withLineTimestamp(line, stamp))
      .filter((line) => line.length > 0)
      .join("\n");
  }

  function pushLog(processId: number, kind: LogLine["kind"], text: string) {
    const stamped = timestampMultiline(text);
    if (!stamped) return;
    setLogs((current) =>
      [
        ...current,
        {
          id: Date.now() + Math.random(),
          processId,
          kind,
          text: `${stamped}\n`,
        },
      ].slice(-600),
    );
  }

  function stripAnsi(text: string) {
    return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
  }

  function formatLbProcessLog(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => {
        if (line.startsWith("@@PARTIAL\t"))
          return `preview: ${line.slice("@@PARTIAL\t".length)}`;
        if (line.startsWith("@@FINAL\t"))
          return `final: ${line.slice("@@FINAL\t".length)}`;
        return line;
      })
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }

  function handleProcessEvent(event: ProcessEvent) {
    if (event.type === "start") {
      activeProcessRef.current = event.processId;
      setActiveProcessId(event.processId);
      setJobPhase("running");
      setActiveLabel(event.label);
      activeLabelRef.current = event.label;
      setStartedAt(Date.now());
      pushLog(
        event.processId,
        "info",
        `Started ${event.label}\n${event.command}\n`,
      );
      return;
    }
    if (event.processId !== activeProcessRef.current) return;
    if (event.type === "stdout") {
      const text = stripAnsi(event.text);
      const handledAsTranscript = updateLiveTranscript(
        text,
        activeLabelRef.current,
      );
      if (
        activeLabelRef.current.includes("Vulkan LB stream") &&
        handledAsTranscript
      ) {
        const logText = formatLbProcessLog(text);
        if (logText) pushLog(event.processId, "stdout", `${logText}\n`);
        return;
      }
      if (!handledAsTranscript) {
        pushLog(event.processId, "stdout", text);
      }
      return;
    }
    if (event.type === "stderr") {
      lastErrorRef.current = event.text.trim().slice(-1200);
      pushLog(event.processId, "stderr", event.text);
      return;
    }
    if (event.type === "exit") {
      pushLog(
        event.processId,
        "exit",
        `Exited with code ${event.code ?? "null"}${event.signal ? ` (${event.signal})` : ""}\n`,
      );
      activeProcessRef.current = null;
      setActiveProcessId(null);
      const wasStopped = stoppingRef.current === event.processId;
      stoppingRef.current = null;
      setJobPhase(
        wasStopped ? "stopped" : event.code === 0 ? "complete" : "error",
      );
      if (!wasStopped && event.code !== 0)
        setJobError(
          lastErrorRef.current ||
            `工作未完成（exit ${event.code ?? event.signal}）。請查看詳細資訊。`,
        );
      activeLabelRef.current = "";
      setNow(Date.now());
      void refreshSessions();
    }
  }

  function handleAssetDownloadEvent(event: AssetDownloadEvent) {
    if (event.type === "start") {
      setAssetDownloads((current) => ({
        ...current,
        [event.assetId]: { running: true, percent: 1, text: "Starting" },
      }));
      return;
    }
    if (event.type === "progress") {
      setAssetDownloads((current) => ({
        ...current,
        [event.assetId]: {
          ...current[event.assetId],
          running: current[event.assetId]?.running ?? true,
          percent: event.percent,
          text: event.text,
        },
      }));
      return;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      pushLog(0, event.type, event.text);
      return;
    }
    if (event.type === "exit") {
      setAssetDownloads((current) => ({
        ...current,
        [event.assetId]: {
          ...current[event.assetId],
          running: false,
          percent:
            event.code === 0 ? 100 : (current[event.assetId]?.percent ?? 0),
          text: event.code === 0 ? "Done" : "Paused",
          exitCode: event.code,
        },
      }));
      void refreshAssets();
    }
  }

  async function refreshAssets() {
    try {
      setAssets(await window.meetingApi.checkAssets());
      setAssetsLoaded(true);
    } catch (error) {
      setJobError(`無法檢查本機模型：${String(error)}`);
    }
  }

  async function refreshAudioDevices() {
    try {
      setAudioDevices(await window.meetingApi.listAudioDevices());
    } catch (error) {
      setAudioDevices({
        defaultSpeaker: "",
        defaultMicrophone: "",
        loopbacks: [],
        microphones: [],
        error: String(error),
      });
    }
  }

  async function loadSettings() {
    let settings: AppSettings;
    try {
      settings = await window.meetingApi.loadSettings();
    } catch (error) {
      setJobError(`無法載入設定：${String(error)}`);
      return;
    }
    savedSettingsRef.current = settings;
    if (isLocale(settings.ui?.locale)) setLocale(settings.ui.locale);
    if (isPostKind(settings.post?.kind)) setPostKind(settings.post.kind);
    else if (settings.live?.mode === "live-cpp-gpu") setPostKind("cpp-gpu");
    if (settings.capture) {
      setSystemDevice(settings.capture.systemDevice || "");
      setMicDevice(settings.capture.micDevice || "");
      setIncludeMic(settings.capture.includeMic === true);
    }
    if (liveModes.some((mode) => mode.id === settings.live?.mode))
      setLiveModeId(settings.live!.mode!);
    if (typeof settings.live?.saveWav === "boolean")
      setSaveWav(settings.live.saveWav);
    if (
      typeof settings.live?.chunkSeconds === "number" &&
      settings.live.chunkSeconds >= 1 &&
      settings.live.chunkSeconds <= 30
    )
      setChunkSeconds(settings.live.chunkSeconds);
    if (settings.outputDir) setOutputDir(settings.outputDir);
    if (typeof settings.qwen?.chunkSeconds === "number")
      setQwenChunkSeconds(settings.qwen.chunkSeconds);
    if (typeof settings.qwen?.tokens === "number")
      setQwenTokens(settings.qwen.tokens);
    if (typeof settings.qwen?.batch === "number")
      setQwenBatch(settings.qwen.batch);
    if (typeof settings.ui?.sessionListWidth === "number")
      setSessionListWidth(settings.ui.sessionListWidth);
    setSettingsLoaded(true);
  }

  async function refreshSessions() {
    let found: OutputSession[];
    try {
      found = await window.meetingApi.listOutputSessions(
        outputDirRef.current.trim() || "outputs",
      );
    } catch (error) {
      setJobError(`無法讀取錄音列表：${String(error)}`);
      return;
    }
    setSessions(found);
    setSelectedSessionId((current) => {
      if (current && found.some((session) => session.id === current))
        return current;
      return found[0]?.id || "";
    });
  }

  async function run(kind: string, args: Record<string, unknown> = {}) {
    if (launchPendingRef.current || activeProcessRef.current !== null) return;
    launchPendingRef.current = true;
    setJobPhase("starting");
    setJobError("");
    lastErrorRef.current = "";
    setStartedAt(null);
    try {
      updateExpectedOutput(kind);
      if (kind.startsWith("live-")) {
        setLiveTranscript("");
        setLivePreviewHistory("");
        setLivePartialTranscript("");
        setLiveTranscriptPath("");
        lbStreamRef.current = { running: "", committedTail: "" };
      }
      await window.meetingApi.runCommand(kind, {
        outputDir: outputDir.trim() || "outputs",
        ...args,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setJobError(message);
      setJobPhase("error");
      pushLog(0, "stderr", `${message}\n`);
    } finally {
      launchPendingRef.current = false;
    }
  }

  async function stop() {
    const processId = activeProcessRef.current;
    if (processId === null || stoppingRef.current === processId) return;
    stoppingRef.current = processId;
    setJobPhase("stopping");
    setJobError("");
    try {
      const result = await window.meetingApi.stopCommand(processId);
      if (!result.stopped && activeProcessRef.current === processId)
        throw new Error("無法確認工作狀態，請查看詳細資訊。");
      // The exit event owns completion; do not announce success before it arrives.
    } catch (error) {
      stoppingRef.current = null;
      if (activeProcessRef.current !== processId) return;
      setJobPhase("running");
      setJobError(`停止失敗：${String(error)}`);
    }
  }

  async function pickAudio() {
    const file = await window.meetingApi.pickAudioFile();
    if (file) {
      setAudioPath(file);
      setSelectedSessionId("");
    }
  }

  async function pickOutputFolder() {
    const folder = await window.meetingApi.pickOutputFolder();
    if (folder) setOutputDir(folder);
  }

  async function downloadAsset(assetId: string) {
    const asset = assets.find((item) => item.id === assetId);
    if (asset?.downloadable === false) return;
    const state = assetDownloads[assetId];
    if (state?.running) {
      await window.meetingApi.stopAssetDownload(assetId);
      return;
    }
    await window.meetingApi.startAssetDownload(assetId);
  }

  async function downloadMissingAssets() {
    for (const asset of assets) {
      if (
        asset.downloadable !== false &&
        !asset.exists &&
        !assetDownloads[asset.id]?.running
      ) {
        await window.meetingApi.startAssetDownload(asset.id);
      }
    }
  }

  function updateExpectedOutput(kind: string) {
    const suffixes: Record<string, string> = {
      "cpp-gpu": "_cpp_gpu_transcript.txt",
      "cpp-cpu": "_cpp_cpu_transcript.txt",
      "cpp-vulkan": "_cpp_vulkan_transcript.txt",
      "cpp-npu": "_cpp_npu_transcript.txt",
      "cpp-openvino-gpu": "_cpp_openvino_gpu_transcript.txt",
      "qwen-gpu": "_qwen_gpu_transcript.txt",
      "qwen-cpu": "_qwen_cpu_transcript.txt",
    };
    const suffix = suffixes[kind];
    const targetAudioPath = selectedAudioPath;
    if (suffix && targetAudioPath) {
      if (targetAudioPath.split(/[\\/]/).pop()?.toLowerCase() === "audio.wav") {
        setLastOutputPath(
          `${targetAudioPath.replace(/[\\/]audio\.wav$/i, "")}\\${suffix.replace(/^_/, "")}`,
        );
        return;
      }
      const sourceName =
        targetAudioPath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.\\/]+$/, "") || "audio";
      const baseDir = outputDir.trim() || "outputs";
      setLastOutputPath(
        `${baseDir.replace(/[\\/]$/, "")}\\${sourceName}${suffix}`,
      );
    }
  }

  function appendPreviewLine(current: string, line: string) {
    const value = normalizeJapaneseSpacing(line);
    if (!value) return current;
    const stampedValue = withLineTimestamp(value);
    if (current.includes(value) || current.includes(stampedValue))
      return current;
    return `${current}${stampedValue}\n`;
  }

  function appendOrMergeFinalLine(current: string, line: string) {
    const stampedValue = withLineTimestamp(line);
    const value = normalizeJapaneseSpacing(stripLineTimestamp(stampedValue));
    if (!value || isHallucinationLine(value)) return current;
    if (/^[\u3001\u3002\uff01\uff1f.,!?]+$/.test(value)) return current;

    const lines = current.split(/\n/).filter((item) => item.trim().length > 0);
    if (lines.length === 0) return `${stampedValue}\n`;

    const valueKey = compactTranscriptKey(value);
    const lookback = Math.min(4, lines.length);
    for (let count = lookback; count >= 1; count--) {
      const start = lines.length - count;
      const tail = normalizeJapaneseSpacing(
        lines.slice(start).map(stripLineTimestamp).join(""),
      );
      if (!tail) continue;
      if (tail === value || tail.includes(value))
        return `${lines.join("\n")}\n`;
      if (value.includes(tail)) {
        return `${[...lines.slice(0, start), stampedValue].join("\n")}\n`;
      }

      const tailKey = compactTranscriptKey(tail);
      if (tailKey && valueKey) {
        if (tailKey.includes(valueKey)) return `${lines.join("\n")}\n`;
        if (valueKey.includes(tailKey))
          return `${[...lines.slice(0, start), stampedValue].join("\n")}\n`;

        const overlap = compactOverlapLength(tailKey, valueKey);
        if (
          overlap >= 8 ||
          overlap >=
            Math.floor(Math.min(tailKey.length, valueKey.length) * 0.45)
        ) {
          return `${[...lines.slice(0, start), stampedValue].join("\n")}\n`;
        }
      }

      const merged = mergePartialText(tail, value);
      if (merged.samePhrase || partialLooksRelated(tail, value)) {
        return `${[...lines.slice(0, start), withLineTimestamp(merged.merged)].join("\n")}\n`;
      }
    }

    return `${lines.join("\n")}\n${stampedValue}\n`;
  }

  function normalizeJapaneseSpacing(text: string) {
    return text
      .trim()
      .replace(
        /([\u3040-\u30ff\u3400-\u9fff])\s+([\u3040-\u30ff\u3400-\u9fff])/g,
        "$1$2",
      )
      .replace(/\s+([\u3001\u3002\uff01\uff1f])/g, "$1")
      .replace(/([\u300c\u300e\uff08])\s+/g, "$1")
      .replace(/\s+/g, " ");
  }

  function compactTranscriptKey(text: string) {
    return normalizeJapaneseSpacing(text)
      .replace(
        /[\s\u3000\u3001\u3002\uff01\uff1f.,!?'"`()[\]{}<>\u300c\u300d\u300e\u300f\uff08\uff09\u3010\u3011]/g,
        "",
      )
      .toLowerCase();
  }

  function compactOverlapLength(previous: string, incoming: string) {
    const maxOverlap = Math.min(previous.length, incoming.length);
    for (let size = maxOverlap; size >= 4; size--) {
      if (previous.slice(-size) === incoming.slice(0, size)) return size;
    }
    return 0;
  }

  function mergePartialText(previous: string, incoming: string) {
    const current = normalizeJapaneseSpacing(previous);
    const next = normalizeJapaneseSpacing(incoming);
    if (!current) return { merged: next, samePhrase: true };
    if (!next) return { merged: current, samePhrase: true };
    if (next.includes(current)) return { merged: next, samePhrase: true };
    if (current.includes(next)) return { merged: current, samePhrase: true };

    const minOverlap = 3;
    const maxOverlap = Math.min(current.length, next.length);
    for (let size = maxOverlap; size >= minOverlap; size--) {
      if (current.slice(-size) === next.slice(0, size)) {
        return { merged: `${current}${next.slice(size)}`, samePhrase: true };
      }
      if (next.slice(-size) === current.slice(0, size)) {
        return { merged: `${next}${current.slice(size)}`, samePhrase: true };
      }
    }

    return { merged: next, samePhrase: false };
  }

  function partialLooksRelated(previous: string, next: string) {
    const a = normalizeJapaneseSpacing(previous);
    const b = normalizeJapaneseSpacing(next);
    if (!a || !b) return true;
    if (a.includes(b) || b.includes(a)) return true;

    const compactA = a.replace(/\s+/g, "");
    const compactB = b.replace(/\s+/g, "");
    if (compactA.includes(compactB) || compactB.includes(compactA)) return true;

    const minOverlap = 4;
    const maxOverlap = Math.min(compactA.length, compactB.length);
    for (let size = maxOverlap; size >= minOverlap; size--) {
      if (compactA.slice(-size) === compactB.slice(0, size)) return true;
      if (compactB.slice(-size) === compactA.slice(0, size)) return true;
    }
    return false;
  }

  function collapseRepeats(text: string) {
    let result = text;
    for (let unit = 2; unit <= 24; unit++) {
      result = result.replace(new RegExp(`(.{${unit}})\\1{3,}`, "g"), "$1");
    }
    return result;
  }

  function cleanTranscriptText(text: string) {
    const normalized = normalizeJapaneseSpacing(text);
    const collapsed = collapseRepeats(normalized);
    if (normalized.length - collapsed.length > 120) return "";
    return collapsed;
  }

  function isHallucinationLine(line: string) {
    const compact = line
      .replace(/\s+/g, "")
      .replace(/[\u3001\u3002\uff01\uff1f]/g, "");
    if (!compact) return true;
    const blocked = [
      "\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f",
      "\u3054\u8996\u8074\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059",
      "\u30c1\u30e3\u30f3\u30cd\u30eb\u767b\u9332\u304a\u9858\u3044\u3057\u307e\u3059",
      "\u6700\u5f8c\u307e\u3067\u3054\u8996\u8074\u3044\u305f\u3060\u304d\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3057\u305f",
    ];
    if (blocked.includes(compact)) return true;
    if (
      /^[\uff08(\[\u3010].*(\u97f3\u697d|\u62cd\u624b|\u7b11|BGM|\u30ce\u30a4\u30ba).*[)\uff09\]\u3011]$/.test(
        line.trim(),
      )
    )
      return true;
    return false;
  }

  function lbTailKey(text: string) {
    const value = text.trim();
    return value.length > 14 ? value.slice(-14) : value;
  }

  function commitLbStreamLine(line: string) {
    const value = cleanTranscriptText(line);
    if (!value || isHallucinationLine(value)) return;
    setLivePreviewHistory((history) => appendOrMergeFinalLine(history, value));
    setLiveTranscript((current) => appendOrMergeFinalLine(current, value));
  }

  // Consolidates the sliding-window hypotheses from the Vulkan loopback stream:
  // overlap-merges each window into a running text, commits completed sentences,
  // and surfaces only the trailing unstable sentence as the live partial.
  function ingestLbStreamLine(raw: string) {
    const normalized = normalizeJapaneseSpacing(raw);
    if (!normalized) return;
    const incoming = collapseRepeats(normalized);
    // A large collapse means whisper emitted a degenerate repetition loop; drop it.
    if (normalized.length - incoming.length > 24) return;
    const state = lbStreamRef.current;

    let trimmed = incoming;
    if (state.committedTail) {
      const idx = trimmed.lastIndexOf(state.committedTail);
      if (idx >= 0) trimmed = trimmed.slice(idx + state.committedTail.length);
    }
    if (!trimmed) {
      setLivePartialTranscript(withLineTimestamp(state.running));
      return;
    }

    const merge = mergePartialText(state.running, trimmed);
    if (
      state.running &&
      !merge.samePhrase &&
      !partialLooksRelated(state.running, trimmed)
    ) {
      commitLbStreamLine(state.running);
      state.committedTail = lbTailKey(state.running);
      state.running = trimmed;
    } else {
      state.running = merge.merged;
    }

    const parts = state.running.split(/(?<=[。！？])/);
    if (parts.length >= 2) {
      const done = parts.slice(0, -1).join("").trim();
      state.running = parts[parts.length - 1];
      if (done) {
        commitLbStreamLine(done);
        state.committedTail = lbTailKey(done);
      }
    } else if (state.running.length > 160) {
      const clause = state.running.lastIndexOf("、", 120);
      const splitAt = clause > 40 ? clause + 1 : 120;
      const done = state.running.slice(0, splitAt).trim();
      state.running = state.running.slice(splitAt);
      if (done) {
        commitLbStreamLine(done);
        state.committedTail = lbTailKey(done);
      }
    }

    setLivePartialTranscript(withLineTimestamp(state.running));
  }

  function updateLiveTranscript(text: string, processLabel = "") {
    const transcriptMatch = text.match(/Transcript:\s*(.+)/);
    if (transcriptMatch) {
      setLiveTranscriptPath(transcriptMatch[1].trim());
    }

    const controlLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let handledControl = false;
    controlLines.forEach((line) => {
      if (line.startsWith("@@PARTIAL\t")) {
        const partialText = line.slice("@@PARTIAL\t".length);
        setLivePartialTranscript(
          withLineTimestamp(cleanTranscriptText(partialText)),
        );
        handledControl = true;
        return;
      }
      if (line.startsWith("@@FINAL\t")) {
        const finalText = cleanTranscriptText(line.slice("@@FINAL\t".length));
        setLivePartialTranscript("");
        commitLbStreamLine(finalText);
        handledControl = true;
        return;
      }
    });
    if (handledControl) return true;

    if (processLabel.includes("Vulkan LB stream")) {
      const rawLines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      rawLines.forEach((line) => commitLbStreamLine(line));
      return rawLines.length > 0;
    }

    const transcriptLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\[\d{2}:\d{2}:\d{2}\]\s+/.test(line));

    if (transcriptLines.length > 0) {
      setLiveTranscript((current) =>
        transcriptLines.reduce(
          (next, line) => appendPreviewLine(next, line),
          current,
        ),
      );
      setLivePreviewHistory((current) =>
        transcriptLines.reduce(
          (next, line) => appendPreviewLine(next, line),
          current,
        ),
      );
      return true;
    }

    return false;
  }

  function dropAudio(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const filePath = window.meetingApi.getDroppedFilePath(file);
    if (filePath) {
      setAudioPath(filePath);
      setSelectedSessionId("");
    } else setJobError("無法讀取拖放檔案，請使用選取音訊。");
  }

  const qwenArgs = useMemo(
    () => ({
      audioPath: selectedAudioPath,
      chunkSeconds: qwenChunkSeconds,
      qwenTokens,
      qwenBatch,
    }),
    [selectedAudioPath, qwenChunkSeconds, qwenTokens, qwenBatch],
  );

  const captureSettings = useMemo(
    () => ({
      systemDevice: systemDevice.trim(),
      includeMic,
      micDevice: micDevice.trim(),
    }),
    [systemDevice, includeMic, micDevice],
  );

  function toggleMenu(menu: MenuName) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024)
      return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatTime(time: number) {
    return new Date(time).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatElapsed(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function clampSessionListWidth(width: number, knownContainerWidth?: number) {
    const containerWidth =
      knownContainerWidth ||
      transcribeLibraryRef.current?.getBoundingClientRect().width ||
      680;
    const minWidth = Math.min(220, Math.max(160, containerWidth - 240));
    const maxWidth = Math.max(minWidth, containerWidth - 228);
    return Math.round(Math.min(Math.max(width, minWidth), maxWidth));
  }

  function updateSessionListWidth(width: number) {
    const nextWidth = clampSessionListWidth(width);
    setSessionListWidth(nextWidth);
  }

  function beginSessionResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = transcribeLibraryRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    function handlePointerMove(moveEvent: PointerEvent) {
      updateSessionListWidth(moveEvent.clientX - rect.left);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    updateSessionListWidth(event.clientX - rect.left);
  }

  function handleSessionDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateSessionListWidth(effectiveSessionListWidth - 24);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updateSessionListWidth(effectiveSessionListWidth + 24);
    }
  }

  async function runMenuAction(action: string) {
    setOpenMenu(null);
    if (action === "open-audio") {
      await pickAudio();
      setTab("transcribe");
      return;
    }
    if (action === "open-recordings") {
      await window.meetingApi.openPath(outputDir.trim() || "outputs");
      return;
    }
    if (action === "open-cpp-output") {
      await window.meetingApi.openPath(outputDir.trim() || "outputs");
      return;
    }
    if (action === "clear-output") {
      setLogs([]);
      return;
    }
    if (action === "setup") {
      setTab("setup");
      return;
    }
    if (action === "toggle-sidebar") {
      setSidebarCollapsed((current) => !current);
      return;
    }
    if (action === "minimize") {
      await window.meetingApi.windowControl("minimize");
      return;
    }
    if (action === "toggle-window") {
      await window.meetingApi.windowControl("maximize");
      return;
    }
    if (action === "github") {
      await window.meetingApi.openPath(
        "https://github.com/kuchris/local-meeting-stt",
      );
      return;
    }
    if (action === "exit") {
      await window.meetingApi.windowControl("close");
    }
  }

  function startLive() {
    if (
      liveUnavailable ||
      !Number.isFinite(chunkSeconds) ||
      chunkSeconds < 1 ||
      chunkSeconds > 30
    )
      return;
    const kind =
      liveMode.optionalWav && !saveWav ? "live-whisper" : liveMode.id;
    return run(kind, {
      chunkSeconds,
      ...(liveMode.capture
        ? captureSettings
        : { systemDevice: "", includeMic: false, micDevice: "" }),
    });
  }

  const pageTitles = {
    live: "即時會議",
    record: "音訊錄製",
    transcribe: "錄音與逐字稿",
    setup: "設定與模型",
  };
  const canStart =
    settingsLoaded &&
    !isRunning &&
    (tab === "live"
      ? !liveUnavailable &&
        Number.isFinite(chunkSeconds) &&
        chunkSeconds >= 1 &&
        chunkSeconds <= 30
      : tab === "transcribe"
        ? Boolean(selectedAudioPath)
        : tab === "record"
          ? !timedRecording ||
            (Number.isFinite(durationSeconds) && durationSeconds > 0)
          : false);
  function startSelected() {
    if (!canStart) return;
    if (tab === "live") void startLive();
    if (tab === "record")
      void run(timedRecording ? "record-timed" : "record-enter", {
        durationSeconds,
        ...captureSettings,
      });
    if (tab === "transcribe")
      void run(
        postKind,
        postKind.startsWith("qwen")
          ? qwenArgs
          : { audioPath: selectedAudioPath },
      );
  }

  return (
    <>
      <header className="window-titlebar">
        <div
          className="window-drag-region"
          onDoubleClick={() => window.meetingApi.windowControl("maximize")}
        >
          <button
            className={`sidebar-toggle ${sidebarCollapsed ? "collapsed" : ""}`}
            title={t("Toggle sidebar  Ctrl+B")}
            aria-label={t("Toggle sidebar")}
            onClick={() => setSidebarCollapsed((current) => !current)}
          />
          <span className="window-app-icon">STT</span>
          <span className="window-title">Local Meeting STT</span>
          <nav className="window-menu" aria-label={t("Application menu")}>
            <div className="menu-group">
              <button
                className={openMenu === "file" ? "open" : ""}
                onClick={() => toggleMenu("file")}
              >
                {t("File")}
              </button>
              {openMenu === "file" && (
                <div className="dropdown-menu">
                  <button onClick={() => void runMenuAction("open-audio")}>
                    <span>{t("Open Audio...")}</span>
                    <kbd>Ctrl+O</kbd>
                  </button>
                  <button onClick={() => void runMenuAction("open-recordings")}>
                    <span>{t("Open Outputs")}</span>
                  </button>
                  <div className="menu-separator" />
                  <button onClick={() => void runMenuAction("exit")}>
                    <span>{t("Exit")}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-group">
              <button
                className={openMenu === "run" ? "open" : ""}
                onClick={() => toggleMenu("run")}
              >
                {t("Run")}
              </button>
              {openMenu === "run" && (
                <div className="dropdown-menu">
                  <button
                    disabled={isRunning || liveUnavailable}
                    onClick={() => {
                      setOpenMenu(null);
                      setTab("live");
                      void startLive();
                    }}
                  >
                    <span>{t("開始所選模型的會議")}</span>
                  </button>
                  <button
                    disabled={
                      activeProcessId === null || jobPhase === "stopping"
                    }
                    onClick={() => {
                      setOpenMenu(null);
                      void stop();
                    }}
                  >
                    <span>{t("停止目前工作")}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-group">
              <button
                className={openMenu === "view" ? "open" : ""}
                onClick={() => toggleMenu("view")}
              >
                {t("View")}
              </button>
              {openMenu === "view" && (
                <div className="dropdown-menu">
                  <button onClick={() => void runMenuAction("toggle-sidebar")}>
                    <span>{t("Toggle Sidebar")}</span>
                    <kbd>Ctrl+B</kbd>
                  </button>
                  <button onClick={() => void runMenuAction("clear-output")}>
                    <span>{t("Clear Logs")}</span>
                  </button>
                  <button onClick={() => void runMenuAction("setup")}>
                    <span>{t("Setup")}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-group">
              <button
                className={openMenu === "window" ? "open" : ""}
                onClick={() => toggleMenu("window")}
              >
                {t("Window")}
              </button>
              {openMenu === "window" && (
                <div className="dropdown-menu">
                  <button onClick={() => void runMenuAction("minimize")}>
                    <span>{t("Minimize")}</span>
                  </button>
                  <button onClick={() => void runMenuAction("toggle-window")}>
                    <span>{t("Maximize / Restore")}</span>
                  </button>
                </div>
              )}
            </div>
            <div className="menu-group">
              <button
                className={openMenu === "help" ? "open" : ""}
                onClick={() => toggleMenu("help")}
              >
                {t("Help")}
              </button>
              {openMenu === "help" && (
                <div className="dropdown-menu">
                  <button onClick={() => void runMenuAction("github")}>
                    <span>{t("GitHub Repository")}</span>
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
        <label className="language-switch" title={t("介面語言")}>
          <span aria-hidden="true">◎</span>
          <select
            id="interface-language"
            aria-label={t("介面語言")}
            value={locale}
            disabled={!settingsLoaded}
            onChange={(event) => {
              if (isLocale(event.target.value)) setLocale(event.target.value);
            }}
          >
            {locales.map((value) => (
              <option key={value} value={value}>
                {localeNames[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="window-controls">
          <button
            className="minimize"
            aria-label={t("Minimize")}
            onClick={() => window.meetingApi.windowControl("minimize")}
          />
          <button
            className="maximize"
            aria-label={t("Maximize")}
            onClick={() => window.meetingApi.windowControl("maximize")}
          />
          <button
            className="close"
            aria-label={t("Close")}
            onClick={() => window.meetingApi.windowControl("close")}
          />
        </div>
      </header>

      <main
        className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          <div className="brand-block">
            <span className="brand-mark">STT</span>
            <div>
              <h1>Meeting</h1>
              <p>{t("日文會議 · 本機字幕")}</p>
            </div>
          </div>

          <nav className="tabs">
            {tabs.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                title={t(item.label)}
                onClick={() => setTab(item.id)}
              >
                <span className="tab-icon">
                  <TabIcon tab={item.id} />
                </span>
                <span className="tab-label">{t(item.label)}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <strong>{t("本機辨識")}</strong>
            <small>{t("音訊留在這部電腦")}</small>
          </div>
        </aside>

        <section className="meeting-workbench">
          <header className="meeting-header">
            <div>
              <span className="eyebrow">{t("LOCAL MEETING STT / 日本語")}</span>
              <h2>{t(pageTitles[tab])}</h2>
            </div>
            <div className="meeting-actions">
              <span className={`job-status ${jobPhase}`} role="status">
                {t(phaseLabels[jobPhase])}
              </span>
              {startedAt !== null && (
                <time className="meeting-clock">
                  {formatElapsed(elapsedSeconds)}
                </time>
              )}
              {isRunning ? (
                <button
                  className="stop-meeting"
                  disabled={activeProcessId === null || jobPhase === "stopping"}
                  onClick={stop}
                >
                  {jobPhase === "starting"
                    ? t("正在啟動…")
                    : jobPhase === "stopping"
                      ? t("正在停止…")
                      : t("停止目前工作")}
                </button>
              ) : (
                tab !== "setup" && (
                  <button
                    className="primary-action"
                    disabled={!canStart}
                    onClick={startSelected}
                  >
                    {tab === "live"
                      ? t("開始會議")
                      : tab === "record"
                        ? t("開始錄音")
                        : t("開始轉錄")}
                  </button>
                )
              )}
            </div>
          </header>
          {jobError && (
            <div className="job-error" role="alert">
              <span>{translateError(locale, jobError)}</span>
              <button onClick={() => setDetailsOpen(true)}>
                {t("查看詳細資訊")}
              </button>
              <button
                aria-label={t("關閉錯誤提示")}
                onClick={() => setJobError("")}
              >
                ×
              </button>
            </div>
          )}
          {isRunning && (
            <p className="active-job">
              {t("目前工作：")}
              {activeLabel || t("正在準備")}
              {t("· 啟動程序不代表已收到音訊")}
            </p>
          )}
          {(tab === "live" || tab === "record") && (
            <section className="capture-toolbar" aria-label={t("會議設定")}>
              {tab === "live" && (
                <label className="field">
                  <span>{t("辨識模型")}</span>
                  <select
                    aria-label={t("辨識模型")}
                    value={liveMode.model}
                    disabled={isRunning}
                    onChange={(event) =>
                      setLiveModeId(
                        liveModes.find(
                          (mode) => mode.model === event.target.value,
                        )!.id,
                      )
                    }
                  >
                    <option value="small">Whisper small</option>
                    <option value="base">Whisper base</option>
                  </select>
                </label>
              )}
              <label className="field">
                <span>{t("系統音源")}</span>
                <select
                  aria-label={t("系統音源")}
                  value={captureSupported ? systemDevice : ""}
                  disabled={isRunning || !captureSupported}
                  onChange={(event) => setSystemDevice(event.target.value)}
                >
                  <option value="">
                    {audioDevices?.defaultSpeaker || t("系統預設音源")}
                    {t("（預設）")}
                  </option>
                  {audioDevices?.loopbacks.map((device) => (
                    <option
                      key={device.id || device.name}
                      value={device.id || device.name}
                    >
                      {device.name}
                    </option>
                  ))}
                  {systemDevice &&
                    !audioDevices?.loopbacks.some(
                      (device) => (device.id || device.name) === systemDevice,
                    ) && (
                      <option value={systemDevice}>{t("裝置未連接")}</option>
                    )}
                </select>
              </label>
              <label className="capture-toggle">
                <input
                  type="checkbox"
                  checked={captureSupported && includeMic}
                  disabled={isRunning || !captureSupported}
                  onChange={(event) => setIncludeMic(event.target.checked)}
                />
                {t("包含麥克風")}
              </label>
              {captureSupported && includeMic && (
                <label className="field">
                  <span>{t("麥克風")}</span>
                  <select
                    aria-label={t("麥克風")}
                    value={micDevice}
                    disabled={isRunning}
                    onChange={(event) => setMicDevice(event.target.value)}
                  >
                    <option value="">
                      {audioDevices?.defaultMicrophone || t("預設麥克風")}
                      {t("（預設）")}
                    </option>
                    {audioDevices?.microphones.map((device) => (
                      <option
                        key={device.id || device.name}
                        value={device.id || device.name}
                      >
                        {device.name}
                      </option>
                    ))}
                    {micDevice &&
                      !audioDevices?.microphones.some(
                        (device) => (device.id || device.name) === micDevice,
                      ) && <option value={micDevice}>{t("裝置未連接")}</option>}
                  </select>
                </label>
              )}
              {tab === "live" && (
                <label className="capture-toggle">
                  <input
                    type="checkbox"
                    checked={liveMode.optionalWav ? saveWav : true}
                    disabled={isRunning || !liveMode.optionalWav}
                    onChange={(event) => setSaveWav(event.target.checked)}
                  />
                  {t("儲存 WAV")}
                </label>
              )}
              <button
                className="quiet-action"
                disabled={isRunning}
                onClick={refreshAudioDevices}
                aria-label={t("重新整理音訊裝置")}
              >
                ↻
              </button>
              <p className="capture-summary">
                {captureSupported
                  ? `${selectedSpeaker}${includeMic ? ` ＋ ${selectedMic}` : t(" · 不含麥克風")}`
                  : t("此後端只支援系統預設 loopback，不支援麥克風混音。")}
                {tab === "live" && !liveMode.optionalWav
                  ? t(" · 此後端會同時錄製 WAV")
                  : ""}
              </p>
              {audioDevices?.error && (
                <p className="capture-warning" role="alert">
                  {t("音訊裝置檢查失敗：")}
                  {audioDevices.error}
                </p>
              )}
            </section>
          )}
          {tab === "live" && (
            <>
              <div className="transcript-toolbar">
                <span>
                  {t("即時字幕")}
                  <small>{t("／ 日本語")}</small>
                </span>
                <label className="capture-toggle">
                  <input
                    type="checkbox"
                    checked={followTranscript}
                    onChange={(event) =>
                      setFollowTranscript(event.target.checked)
                    }
                  />
                  {t("跟隨最新字幕")}
                </label>
              </div>
              <pre
                className="meeting-transcript"
                ref={outputRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  if (
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight >
                    48
                  )
                    setFollowTranscript(false);
                }}
              >
                {livePreviewHistory ||
                  liveTranscript ||
                  (!livePartialTranscript
                    ? t("確認音源後開始會議，字幕會顯示在這裡。")
                    : "")}
                {livePartialTranscript && (
                  <span className="partial-caption">
                    {`\n${livePartialTranscript}`}
                    <small>{t("辨識中 · 文字仍可能修訂")}</small>
                  </span>
                )}
              </pre>
              <div className="transcript-footer">
                <span>
                  {liveTranscriptPath || `${t("輸出資料夾：")}${outputDir}`}
                </span>
                {liveTranscriptPath && (
                  <button
                    onClick={() =>
                      window.meetingApi.openPath(liveTranscriptPath)
                    }
                  >
                    {t("開啟逐字稿")}
                  </button>
                )}
              </div>
              {liveUnavailable && (
                <div className="asset-notice">
                  {assetsLoaded
                    ? `${t("缺少此組合的檔案")}${missingAssets.length ? `: ${missingAssets.map((asset) => asset.label).join(", ")}` : ""}`
                    : t("正在檢查本機模型…")}
                  <button onClick={() => setTab("setup")}>
                    {t("管理模型與後端")}
                  </button>
                </div>
              )}
            </>
          )}
          {tab === "record" && (
            <section className="recording-workspace">
              <div className="recording-symbol" aria-hidden="true">
                ●
              </div>
              <h3>
                {isRunning
                  ? t("音訊錄製程序已啟動")
                  : t("只保留音訊，稍後再轉錄")}
              </h3>
              <p>{t("錄製系統音源，並依設定混入麥克風。")}</p>
              <label className="capture-toggle">
                <input
                  type="checkbox"
                  checked={timedRecording}
                  disabled={isRunning}
                  onChange={(event) => setTimedRecording(event.target.checked)}
                />
                {t("設定錄音時限")}
              </label>
              {timedRecording && (
                <label className="field">
                  <span>{t("錄音秒數")}</span>
                  <input
                    type="number"
                    min="1"
                    value={durationSeconds}
                    disabled={isRunning}
                    onChange={(event) =>
                      setDurationSeconds(Number(event.target.value))
                    }
                  />
                </label>
              )}
              <small>
                {t("儲存位置：")}
                {outputDir}
                {t("· 使用頂部按鈕停止")}
              </small>
            </section>
          )}
          {(tab === "transcribe" || tab === "setup") && (
            <section className={`secondary-workspace ${tab}`}>
              <div className="panel">
                {tab === "transcribe" && (
                  <section
                    className="transcribe-library"
                    ref={transcribeLibraryRef}
                    style={{
                      gridTemplateColumns: `${effectiveSessionListWidth}px 8px minmax(0, 1fr)`,
                    }}
                  >
                    <section className="session-list">
                      <div className="section-head">
                        <h3>{t("錄音列表")}</h3>
                        <button
                          className="tiny-icon light"
                          title={t("Refresh sessions")}
                          aria-label={t("Refresh sessions")}
                          onClick={refreshSessions}
                        >
                          ↻
                        </button>
                      </div>
                      <div className="session-items">
                        {sessions.map((session) => (
                          <button
                            key={session.id}
                            className={`session-row ${selectedSessionId === session.id ? "active" : ""}`}
                            onClick={() => {
                              setSelectedSessionId(session.id);
                              setAudioPath("");
                            }}
                          >
                            <strong>{session.name}</strong>
                            <small>
                              {formatBytes(session.audioSize)} ·{" "}
                              {formatTime(session.modifiedTime)}
                            </small>
                            <span className="session-badges">
                              {(session.transcripts.cppCpu ||
                                session.transcripts.cppGpu ||
                                session.transcripts.cppVulkan ||
                                session.transcripts.cppNpu ||
                                session.transcripts.cppOpenvinoGpu) && (
                                <span>C</span>
                              )}
                              {(session.transcripts.qwenCpu ||
                                session.transcripts.qwenGpu) && <span>Q</span>}
                            </span>
                          </button>
                        ))}
                        {sessions.length === 0 && (
                          <div className="empty-sessions">
                            {t("此資料夾尚無錄音。")}
                          </div>
                        )}
                      </div>
                      <div className="session-footer">
                        <div
                          className="dropzone compact"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={dropAudio}
                        >
                          {t("拖放音訊檔案")}
                        </div>
                        <button
                          className="icon-button"
                          title={t("Choose external audio")}
                          aria-label={t("Choose external audio")}
                          onClick={pickAudio}
                        >
                          <AudioFileIcon />
                        </button>
                      </div>
                    </section>

                    <div
                      className="pane-divider"
                      role="separator"
                      aria-label={t("Resize session list")}
                      aria-orientation="vertical"
                      aria-valuemin={Math.min(
                        220,
                        Math.max(160, (transcribeLibraryWidth || 680) - 240),
                      )}
                      aria-valuemax={Math.max(
                        160,
                        (transcribeLibraryWidth || 680) - 228,
                      )}
                      aria-valuenow={effectiveSessionListWidth}
                      tabIndex={0}
                      onPointerDown={beginSessionResize}
                      onKeyDown={handleSessionDividerKey}
                    />

                    <section className="selected-session">
                      <div className="section-head">
                        <h3>{t("所選錄音")}</h3>
                        {selectedSession && (
                          <button
                            className="tiny-icon light"
                            title={t("Open session folder")}
                            aria-label={t("Open session folder")}
                            onClick={() =>
                              window.meetingApi.openPath(
                                selectedSession.folderPath,
                              )
                            }
                          >
                            <OutputActionIcon action="open" />
                          </button>
                        )}
                      </div>
                      <div className="selected-audio">
                        <strong>
                          {selectedSession?.name || t("外部音訊")}
                        </strong>
                        <small>
                          {selectedAudioPath || t("選取錄音或匯入音訊檔案。")}
                        </small>
                      </div>
                      <div
                        className="qwen-settings"
                        hidden={!postKind.startsWith("qwen")}
                      >
                        <div className="qwen-settings-head">
                          <strong>{t("Qwen 轉錄設定")}</strong>
                        </div>
                        <div className="qwen-setting-fields">
                          <label className="field">
                            <span>{t("Chunk")}</span>
                            <input
                              type="number"
                              min="10"
                              value={qwenChunkSeconds}
                              onChange={(event) =>
                                setQwenChunkSeconds(Number(event.target.value))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>{t("Tokens")}</span>
                            <input
                              type="number"
                              min="256"
                              value={qwenTokens}
                              onChange={(event) =>
                                setQwenTokens(Number(event.target.value))
                              }
                            />
                          </label>
                          <label className="field">
                            <span>{t("Batch")}</span>
                            <input
                              type="number"
                              min="1"
                              value={qwenBatch}
                              onChange={(event) =>
                                setQwenBatch(Number(event.target.value))
                              }
                            />
                          </label>
                        </div>
                      </div>
                      <label className="field">
                        <span>{t("辨識模型")}</span>
                        <select
                          aria-label={t("辨識模型")}
                          value={postKind.startsWith("qwen") ? "qwen" : "small"}
                          disabled={isRunning}
                          onChange={(event) =>
                            setPostKind(
                              switchPostModel(postKind, event.target.value),
                            )
                          }
                        >
                          <option value="small">Whisper small</option>
                          <option value="qwen">Qwen3-ASR 0.6B</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{t("執行後端")}</span>
                        <select
                          aria-label={t("執行後端")}
                          value={postKind}
                          disabled={isRunning}
                          onChange={(event) => setPostKind(event.target.value)}
                        >
                          {(postKind.startsWith("qwen")
                            ? [
                                ["qwen-cpu", "CPU"],
                                ["qwen-gpu", "CUDA"],
                              ]
                            : [
                                ["cpp-cpu", "CPU"],
                                ["cpp-gpu", "CUDA"],
                                ["cpp-vulkan", "Vulkan"],
                                ["cpp-npu", "OpenVINO NPU"],
                                ["cpp-openvino-gpu", "OpenVINO GPU"],
                              ]
                          ).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {lastOutputPath && jobPhase === "complete" && (
                        <button
                          className="output-path"
                          onClick={() =>
                            window.meetingApi.openPath(lastOutputPath)
                          }
                        >
                          {t("開啟逐字稿：")}
                          {lastOutputPath}
                        </button>
                      )}
                    </section>
                  </section>
                )}
                {tab === "setup" && (
                  <section className="stack">
                    <h3>{t("模型與後端檔案")}</h3>
                    <div className="asset-list">
                      {assets.map((asset) => {
                        const download = assetDownloads[asset.id];
                        const isDownloading = download?.running === true;
                        return (
                          <div key={asset.relativePath} className="asset-row">
                            <span
                              className={
                                asset.exists
                                  ? "ok-dot"
                                  : isDownloading
                                    ? "busy-dot"
                                    : "bad-dot"
                              }
                            />
                            <div className="asset-main">
                              <strong>{asset.label}</strong>
                              <small>{asset.relativePath}</small>
                              {asset.note && <small>{t(asset.note)}</small>}
                              {download && (
                                <div
                                  className={`asset-progress ${isDownloading ? "running" : ""}`}
                                >
                                  <span>
                                    <i
                                      style={{ width: `${download.percent}%` }}
                                    />
                                  </span>
                                  <small>{t(download.text)}</small>
                                </div>
                              )}
                            </div>
                            <button
                              className="asset-download"
                              title={
                                isDownloading
                                  ? t("暫停 {name}", { name: asset.label })
                                  : t("下載 {name}", { name: asset.label })
                              }
                              aria-label={
                                isDownloading
                                  ? t("暫停 {name}", { name: asset.label })
                                  : t("下載 {name}", { name: asset.label })
                              }
                              onClick={() => downloadAsset(asset.id)}
                              disabled={asset.downloadable === false}
                            >
                              {isDownloading ? <PauseIcon /> : <DownloadIcon />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div
                      className="setup-actions"
                      aria-label={t("Setup actions")}
                    >
                      <button
                        title={t("Refresh status")}
                        aria-label={t("Refresh status")}
                        onClick={refreshAssets}
                      >
                        ↻
                      </button>
                      <button
                        title={t("Download missing assets")}
                        aria-label={t("Download missing assets")}
                        onClick={downloadMissingAssets}
                      >
                        ↓
                      </button>
                      <button
                        title={t("Open outputs")}
                        aria-label={t("Open outputs")}
                        onClick={() =>
                          window.meetingApi.openPath(
                            outputDir.trim() || "outputs",
                          )
                        }
                      >
                        ▣
                      </button>
                    </div>
                    <section className="output-settings">
                      <h3>{t("輸出資料夾")}</h3>
                      <div className="output-folder-row">
                        <input
                          aria-label={t("Output folder")}
                          disabled={isRunning}
                          value={outputDir}
                          onChange={(event) => setOutputDir(event.target.value)}
                          placeholder="outputs"
                        />
                        <div
                          className="output-icon-actions"
                          aria-label={t("Output folder actions")}
                        >
                          <button
                            className="icon-button"
                            title={t("Choose output folder")}
                            aria-label={t("Choose output folder")}
                            onClick={pickOutputFolder}
                          >
                            <OutputActionIcon action="choose" />
                          </button>
                          <button
                            className="icon-button"
                            title={t("Open output folder")}
                            aria-label={t("Open output folder")}
                            onClick={() =>
                              window.meetingApi.openPath(
                                outputDir.trim() || "outputs",
                              )
                            }
                          >
                            <OutputActionIcon action="open" />
                          </button>
                          <button
                            className="icon-button"
                            title={t("Reset output folder")}
                            aria-label={t("Reset output folder")}
                            onClick={() => setOutputDir("outputs")}
                          >
                            <OutputActionIcon action="reset" />
                          </button>
                        </div>
                      </div>
                    </section>
                  </section>
                )}
              </div>
            </section>
          )}
          <section
            className={`meeting-details ${detailsOpen ? "expanded" : ""}`}
          >
            <div className="details-heading">
              <span>
                {tab === "live"
                  ? `${t(liveMode.label)} · Whisper ${liveMode.model}`
                  : t("工作詳細資訊")}
              </span>
              <button
                aria-expanded={detailsOpen}
                aria-controls="meeting-details-content"
                onClick={() => setDetailsOpen((current) => !current)}
              >
                {detailsOpen ? t("收起詳細資訊") : t("詳細資訊")}
              </button>
            </div>
            {detailsOpen && (
              <div id="meeting-details-content">
                {tab === "live" && (
                  <div className="advanced-live">
                    <label className="field">
                      <span>{t("執行後端")}</span>
                      <select
                        aria-label={t("執行後端")}
                        value={liveModeId}
                        disabled={isRunning}
                        onChange={(event) => setLiveModeId(event.target.value)}
                      >
                        {liveModes
                          .filter((mode) => mode.model === liveMode.model)
                          .map((mode) => (
                            <option key={mode.id} value={mode.id}>
                              {t(mode.label)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>{t("音訊分段（秒）")}</span>
                      <input
                        aria-label={t("音訊分段秒數")}
                        type="number"
                        min="1"
                        max="30"
                        value={chunkSeconds}
                        disabled={isRunning || !liveMode.capture}
                        onChange={(event) =>
                          setChunkSeconds(Number(event.target.value))
                        }
                      />
                    </label>
                    {!liveMode.capture && (
                      <small>{t("Loopback 使用後端內建的 VAD 分段。")}</small>
                    )}
                    {liveMode.capture && (
                      <small>
                        {t(
                          "每段收集完成後才辨識；想更快更新可試 2 秒，短分段可能影響句子完整度。停止會釋放模型。",
                        )}
                      </small>
                    )}
                  </div>
                )}
                <div className="logs-head">
                  <h3>{t("Process log")}</h3>
                  <button onClick={() => setLogs([])}>{t("清除 log")}</button>
                </div>
                <pre className="meeting-log" ref={logsRef}>
                  {logs.length
                    ? logs.map((line) => (
                        <span key={line.id} className={line.kind}>
                          {line.text}
                        </span>
                      ))
                    : t("尚無程序訊息。")}
                </pre>
              </div>
            )}
          </section>
        </section>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
