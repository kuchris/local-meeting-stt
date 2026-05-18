import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings, AssetDownloadEvent, AssetStatus, AudioDeviceStatus, OutputSession, ProcessEvent } from "./types";
import "./styles.css";

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
  { id: "live", label: "Live" },
  { id: "record", label: "Record" },
  { id: "transcribe", label: "Transcribe" },
  { id: "setup", label: "Setup" }
];

const tabCopy: Record<Tab, { title: string; detail: string }> = {
  live: { title: "Live Meeting", detail: "Start a live recorder and keep the rough transcript visible while logs stream beside it." },
  record: { title: "Audio Recording", detail: "Capture Teams/system audio as a WAV file without running transcription." },
  transcribe: { title: "Post Transcription", detail: "Drop a recording and run whisper.cpp or Qwen after the meeting." },
  setup: { title: "Local Assets", detail: "Check models, whisper.cpp binaries, and download missing local assets." }
};

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
  const [audioDevices, setAudioDevices] = useState<AudioDeviceStatus | null>(null);
  const [assets, setAssets] = useState<AssetStatus[]>([]);
  const [assetDownloads, setAssetDownloads] = useState<Record<string, AssetDownloadState>>({});
  const [lastOutputPath, setLastOutputPath] = useState("");
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem("meetingOutputDir") || "outputs");
  const [sessions, setSessions] = useState<OutputSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveTranscriptPath, setLiveTranscriptPath] = useState("");
  const [activeLabel, setActiveLabel] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sessionListWidth, setSessionListWidth] = useState(() => Number(localStorage.getItem("meetingSessionListWidth")) || 300);
  const [transcribeLibraryWidth, setTranscribeLibraryWidth] = useState(0);
  const [transcribeColumnWidth, setTranscribeColumnWidth] = useState(() => Number(localStorage.getItem("meetingTranscribeColumnWidth")) || 560);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const transcribeLibraryRef = useRef<HTMLElement | null>(null);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  const isRunning = activeProcessId !== null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedAudioPath = selectedSession?.audioPath || audioPath;
  const elapsedSeconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const effectiveSessionListWidth = clampSessionListWidth(sessionListWidth, transcribeLibraryWidth);
  const effectiveTranscribeColumnWidth = clampTranscribeColumnWidth(transcribeColumnWidth, workspaceWidth);

  useEffect(() => {
    const unsubscribe = window.meetingApi.onProcessEvent((event) => {
      handleProcessEvent(event);
    });
    const unsubscribeAssetDownloads = window.meetingApi.onAssetDownloadEvent((event) => {
      handleAssetDownloadEvent(event);
    });
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
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight;
  }, [liveTranscript, lastOutputPath, tab]);

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
    const element = workspaceRef.current;
    if (!element) return;
    const observedElement = element;

    function updateWidth() {
      setWorkspaceWidth(observedElement.getBoundingClientRect().width);
    }

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(observedElement);
    return () => observer.disconnect();
  }, [tab]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const settings: AppSettings = {
      outputDir,
      qwen: {
        chunkSeconds: qwenChunkSeconds,
        tokens: qwenTokens,
        batch: qwenBatch
      },
      ui: {
        sessionListWidth,
        transcribeColumnWidth
      }
    };
    localStorage.setItem("meetingOutputDir", outputDir);
    localStorage.setItem("meetingSessionListWidth", String(sessionListWidth));
    localStorage.setItem("meetingTranscribeColumnWidth", String(transcribeColumnWidth));
    void window.meetingApi.saveSettings(settings);
  }, [outputDir, qwenChunkSeconds, qwenTokens, qwenBatch, sessionListWidth, transcribeColumnWidth, settingsLoaded]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function pushLog(processId: number, kind: LogLine["kind"], text: string) {
    setLogs((current) => [...current, { id: Date.now() + Math.random(), processId, kind, text }].slice(-600));
  }

  function handleProcessEvent(event: ProcessEvent) {
    if (event.type === "start") {
      setActiveProcessId(event.processId);
      setActiveLabel(event.label);
      setStartedAt(Date.now());
      pushLog(event.processId, "info", `Started ${event.label}\n${event.command}\n`);
      return;
    }
    if (event.type === "stdout") {
      updateLiveTranscript(event.text);
      pushLog(event.processId, "stdout", event.text);
      return;
    }
    if (event.type === "stderr") {
      pushLog(event.processId, "stderr", event.text);
      return;
    }
    if (event.type === "exit") {
      pushLog(event.processId, "exit", `Exited with code ${event.code ?? "null"}${event.signal ? ` (${event.signal})` : ""}\n`);
      setActiveProcessId((current) => (current === event.processId ? null : current));
      setStartedAt(null);
      void refreshSessions();
    }
  }

  function handleAssetDownloadEvent(event: AssetDownloadEvent) {
    if (event.type === "start") {
      setAssetDownloads((current) => ({
        ...current,
        [event.assetId]: { running: true, percent: 1, text: "Starting" }
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
          text: event.text
        }
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
          percent: event.code === 0 ? 100 : current[event.assetId]?.percent ?? 0,
          text: event.code === 0 ? "Done" : "Paused",
          exitCode: event.code
        }
      }));
      void refreshAssets();
    }
  }

  async function refreshAssets() {
    setAssets(await window.meetingApi.checkAssets());
  }

  async function refreshAudioDevices() {
    setAudioDevices(await window.meetingApi.listAudioDevices());
  }

  async function loadSettings() {
    const settings = await window.meetingApi.loadSettings();
    if (settings.outputDir) setOutputDir(settings.outputDir);
    if (typeof settings.qwen?.chunkSeconds === "number") setQwenChunkSeconds(settings.qwen.chunkSeconds);
    if (typeof settings.qwen?.tokens === "number") setQwenTokens(settings.qwen.tokens);
    if (typeof settings.qwen?.batch === "number") setQwenBatch(settings.qwen.batch);
    if (typeof settings.ui?.sessionListWidth === "number") setSessionListWidth(settings.ui.sessionListWidth);
    if (typeof settings.ui?.transcribeColumnWidth === "number") setTranscribeColumnWidth(settings.ui.transcribeColumnWidth);
    setSettingsLoaded(true);
  }

  async function refreshSessions() {
    const found = await window.meetingApi.listOutputSessions(outputDir.trim() || "outputs");
    setSessions(found);
    setSelectedSessionId((current) => {
      if (current && found.some((session) => session.id === current)) return current;
      return found[0]?.id || "";
    });
  }

  async function run(kind: string, args: Record<string, unknown> = {}) {
    try {
      updateExpectedOutput(kind);
      if (kind.startsWith("live-")) {
        setLiveTranscript("");
        setLiveTranscriptPath("");
      }
      await window.meetingApi.runCommand(kind, { outputDir: outputDir.trim() || "outputs", ...args });
    } catch (error) {
      pushLog(0, "stderr", `${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  async function stop() {
    if (activeProcessId !== null) {
      await window.meetingApi.stopCommand(activeProcessId);
      setActiveProcessId(null);
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
    const state = assetDownloads[assetId];
    if (state?.running) {
      await window.meetingApi.stopAssetDownload(assetId);
      return;
    }
    await window.meetingApi.startAssetDownload(assetId);
  }

  async function downloadMissingAssets() {
    for (const asset of assets) {
      if (!asset.exists && !assetDownloads[asset.id]?.running) {
        await window.meetingApi.startAssetDownload(asset.id);
      }
    }
  }

  function updateExpectedOutput(kind: string) {
    const suffixes: Record<string, string> = {
      "cpp-gpu": "_cpp_gpu_transcript.txt",
      "cpp-cpu": "_cpp_cpu_transcript.txt",
      "qwen-gpu": "_qwen_gpu_transcript.txt",
      "qwen-cpu": "_qwen_cpu_transcript.txt"
    };
    const suffix = suffixes[kind];
    const targetAudioPath = selectedAudioPath;
    if (suffix && targetAudioPath) {
      if (targetAudioPath.split(/[\\/]/).pop()?.toLowerCase() === "audio.wav") {
        setLastOutputPath(`${targetAudioPath.replace(/[\\/]audio\.wav$/i, "")}\\${suffix.replace(/^_/, "")}`);
        return;
      }
      const sourceName = targetAudioPath.split(/[\\/]/).pop()?.replace(/\.[^.\\/]+$/, "") || "audio";
      const baseDir = outputDir.trim() || "outputs";
      setLastOutputPath(`${baseDir.replace(/[\\/]$/, "")}\\${sourceName}${suffix}`);
    }
  }

  function updateLiveTranscript(text: string) {
    const transcriptMatch = text.match(/Transcript:\s*(.+)/);
    if (transcriptMatch) {
      setLiveTranscriptPath(transcriptMatch[1].trim());
    }

    const transcriptLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\[\d{2}:\d{2}:\d{2}\]\s+/.test(line));

    if (transcriptLines.length > 0) {
      setLiveTranscript((current) => `${current}${transcriptLines.join("\n")}\n`);
    }
  }

  function dropAudio(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (file?.path) {
      setAudioPath(file.path);
      setSelectedSessionId("");
    }
  }

  const qwenArgs = useMemo(
    () => ({ audioPath: selectedAudioPath, chunkSeconds: qwenChunkSeconds, qwenTokens, qwenBatch }),
    [selectedAudioPath, qwenChunkSeconds, qwenTokens, qwenBatch]
  );

  const captureSettings = useMemo(
    () => ({
      systemDevice: systemDevice.trim(),
      includeMic,
      micDevice: micDevice.trim()
    }),
    [systemDevice, includeMic, micDevice]
  );

  function toggleMenu(menu: MenuName) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatTime(time: number) {
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatElapsed(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function clampSessionListWidth(width: number, knownContainerWidth?: number) {
    const containerWidth = knownContainerWidth || transcribeLibraryRef.current?.getBoundingClientRect().width || 680;
    const minWidth = Math.min(220, Math.max(160, containerWidth - 240));
    const maxWidth = Math.max(minWidth, containerWidth - 228);
    return Math.round(Math.min(Math.max(width, minWidth), maxWidth));
  }

  function updateSessionListWidth(width: number) {
    const nextWidth = clampSessionListWidth(width);
    setSessionListWidth(nextWidth);
  }

  function clampTranscribeColumnWidth(width: number, knownWorkspaceWidth?: number) {
    const containerWidth = knownWorkspaceWidth || workspaceRef.current?.getBoundingClientRect().width || 900;
    const minWidth = Math.min(520, Math.max(420, containerWidth - 304));
    const maxWidth = Math.max(minWidth, containerWidth - 304);
    return Math.round(Math.min(Math.max(width, minWidth), maxWidth));
  }

  function updateTranscribeColumnWidth(width: number) {
    const nextWidth = clampTranscribeColumnWidth(width);
    setTranscribeColumnWidth(nextWidth);
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

  function beginOutputResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = workspaceRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    function handlePointerMove(moveEvent: PointerEvent) {
      updateTranscribeColumnWidth(moveEvent.clientX - rect.left);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    updateTranscribeColumnWidth(event.clientX - rect.left);
  }

  function handleOutputDividerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateTranscribeColumnWidth(effectiveTranscribeColumnWidth - 24);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updateTranscribeColumnWidth(effectiveTranscribeColumnWidth + 24);
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
      setLiveTranscript("");
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
    if (action === "live-meeting") {
      await run("live-meeting", { chunkSeconds, ...captureSettings });
      return;
    }
    if (action === "live-whisper") {
      await run("live-whisper", { chunkSeconds, ...captureSettings });
      return;
    }
    if (action === "live-cpp-gpu") {
      await run("live-cpp-gpu", { chunkSeconds, ...captureSettings });
      return;
    }
    if (action === "live-cpp-cpu") {
      await run("live-cpp-cpu", { chunkSeconds, ...captureSettings });
      return;
    }
    if (action === "live-cpp-server-cpu") {
      await run("live-cpp-server-cpu", { chunkSeconds, ...captureSettings });
      return;
    }
    if (action === "stop") {
      await stop();
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
      await window.meetingApi.openPath("https://github.com/kuchris/local-meeting-stt");
      return;
    }
    if (action === "exit") {
      await window.meetingApi.windowControl("close");
    }
  }

  return (
    <>
    <header className="window-titlebar">
      <div className="window-drag-region" onDoubleClick={() => window.meetingApi.windowControl("maximize")}>
        <button
          className={`sidebar-toggle ${sidebarCollapsed ? "collapsed" : ""}`}
          title="Toggle sidebar  Ctrl+B"
          aria-label="Toggle sidebar"
          onClick={() => setSidebarCollapsed((current) => !current)}
        />
        <span className="window-app-icon">STT</span>
        <span className="window-title">Local Meeting STT</span>
        <nav className="window-menu" aria-label="Application menu">
          <div className="menu-group">
            <button className={openMenu === "file" ? "open" : ""} onClick={() => toggleMenu("file")}>File</button>
            {openMenu === "file" && (
              <div className="dropdown-menu">
                <button onClick={() => void runMenuAction("open-audio")}><span>Open Audio...</span><kbd>Ctrl+O</kbd></button>
                <button onClick={() => void runMenuAction("open-recordings")}><span>Open Outputs</span></button>
                <div className="menu-separator" />
                <button onClick={() => void runMenuAction("exit")}><span>Exit</span></button>
              </div>
            )}
          </div>
          <div className="menu-group">
            <button className={openMenu === "run" ? "open" : ""} onClick={() => toggleMenu("run")}>Run</button>
            {openMenu === "run" && (
              <div className="dropdown-menu">
                <button disabled={isRunning} onClick={() => void runMenuAction("live-meeting")}><span>Live + WAV</span></button>
                <button disabled={isRunning} onClick={() => void runMenuAction("live-whisper")}><span>Live Text</span></button>
                <button disabled={isRunning} onClick={() => void runMenuAction("live-cpp-gpu")}><span>CPP GPU Live</span></button>
                <button disabled={isRunning} onClick={() => void runMenuAction("live-cpp-cpu")}><span>CPP CPU Live</span></button>
                <button disabled={isRunning} onClick={() => void runMenuAction("live-cpp-server-cpu")}><span>CPP Server Live</span></button>
                <div className="menu-separator" />
                <button disabled={!isRunning} onClick={() => void runMenuAction("stop")}><span>Stop</span></button>
              </div>
            )}
          </div>
          <div className="menu-group">
            <button className={openMenu === "view" ? "open" : ""} onClick={() => toggleMenu("view")}>View</button>
            {openMenu === "view" && (
              <div className="dropdown-menu">
                <button onClick={() => void runMenuAction("toggle-sidebar")}><span>Toggle Sidebar</span><kbd>Ctrl+B</kbd></button>
                <button onClick={() => void runMenuAction("clear-output")}><span>Clear Logs</span></button>
                <button onClick={() => void runMenuAction("setup")}><span>Setup</span></button>
              </div>
            )}
          </div>
          <div className="menu-group">
            <button className={openMenu === "window" ? "open" : ""} onClick={() => toggleMenu("window")}>Window</button>
            {openMenu === "window" && (
              <div className="dropdown-menu">
                <button onClick={() => void runMenuAction("minimize")}><span>Minimize</span></button>
                <button onClick={() => void runMenuAction("toggle-window")}><span>Maximize / Restore</span></button>
              </div>
            )}
          </div>
          <div className="menu-group">
            <button className={openMenu === "help" ? "open" : ""} onClick={() => toggleMenu("help")}>Help</button>
            {openMenu === "help" && (
              <div className="dropdown-menu">
                <button onClick={() => void runMenuAction("github")}><span>GitHub Repository</span></button>
              </div>
            )}
          </div>
        </nav>
      </div>
      <div className="window-controls">
        <button className="minimize" aria-label="Minimize" onClick={() => window.meetingApi.windowControl("minimize")} />
        <button className="maximize" aria-label="Maximize" onClick={() => window.meetingApi.windowControl("maximize")} />
        <button className="close" aria-label="Close" onClick={() => window.meetingApi.windowControl("close")} />
      </div>
    </header>

    <main className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand-block">
          <span className="brand-mark">STT</span>
          <div>
            <h1>Meeting STT</h1>
            <p>Local control panel</p>
          </div>
        </div>

        <nav className="tabs">
          {tabs.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} title={item.label} onClick={() => setTab(item.id)}>
              <span className="tab-icon"><TabIcon tab={item.id} /></span>
              <span className="tab-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className={`run-state ${isRunning ? "running" : ""}`} title={isRunning ? `Running #${activeProcessId}` : "Idle"}>
          <span className="run-state-dot" />
          <span className="run-state-label">{isRunning ? `Running #${activeProcessId}` : "Idle"}</span>
        </div>
      </aside>

      <section className="workbench">
        <section
          className={`workspace ${tab === "setup" ? "setup-workspace" : ""} ${tab === "transcribe" ? "transcribe-workspace" : ""}`}
          ref={workspaceRef}
          style={tab === "transcribe" ? { gridTemplateColumns: `${effectiveTranscribeColumnWidth}px 8px minmax(280px, 1fr)` } : undefined}
        >
          <section className="primary-column">
            <header className="topbar">
              <div>
                <span className="eyebrow">{tab}</span>
                <h2>{tabCopy[tab].title}</h2>
                <p>{tabCopy[tab].detail}</p>
              </div>
            </header>

            <div className="panel">
            {tab === "live" && (
              <section className="stack">
                <h3>Engine</h3>
                <label className="field">
                  <span>Chunk seconds</span>
                  <input type="number" min="1" max="30" value={chunkSeconds} onChange={(event) => setChunkSeconds(Number(event.target.value))} />
                </label>
                <div className="grid-actions command-grid">
                  <button disabled={isRunning} onClick={() => run("live-meeting", { chunkSeconds, ...captureSettings })}>Live + WAV</button>
                  <button disabled={isRunning} onClick={() => run("live-whisper", { chunkSeconds, ...captureSettings })}>Live Text</button>
                  <button disabled={isRunning} onClick={() => run("live-cpp-gpu", { chunkSeconds, ...captureSettings })}>CPP GPU</button>
                  <button disabled={isRunning} onClick={() => run("live-cpp-cpu", { chunkSeconds, ...captureSettings })}>CPP CPU</button>
                  <button disabled={isRunning} onClick={() => run("live-cpp-server-cpu", { chunkSeconds, ...captureSettings })}>CPP Server</button>
                </div>
                <button className="danger" disabled={!isRunning} onClick={stop}>Stop active process</button>
              </section>
            )}

            {tab === "record" && (
              <section className="stack">
                <h3>Capture</h3>
                <label className="field">
                  <span>Timed recording seconds</span>
                  <input type="number" min="1" value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))} />
                </label>
                <div className="grid-actions">
                  <button disabled={isRunning} onClick={() => run("record-enter", captureSettings)}>Until Enter</button>
                  <button disabled={isRunning} onClick={() => run("record-timed", { durationSeconds, ...captureSettings })}>Timed WAV</button>
                </div>
                <button className="danger" disabled={!isRunning} onClick={stop}>Stop active process</button>
              </section>
            )}

            {tab === "transcribe" && (
              <section
                className="transcribe-library"
                ref={transcribeLibraryRef}
                style={{ gridTemplateColumns: `${effectiveSessionListWidth}px 8px minmax(0, 1fr)` }}
              >
                <section className="session-list">
                  <div className="section-head">
                    <h3>Sessions</h3>
                    <button className="tiny-icon light" title="Refresh sessions" aria-label="Refresh sessions" onClick={refreshSessions}>↻</button>
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
                        <small>{formatBytes(session.audioSize)} · {formatTime(session.modifiedTime)}</small>
                        <span className="session-badges">
                          {(session.transcripts.cppCpu || session.transcripts.cppGpu) && <span>C</span>}
                          {(session.transcripts.qwenCpu || session.transcripts.qwenGpu) && <span>Q</span>}
                        </span>
                      </button>
                    ))}
                    {sessions.length === 0 && <div className="empty-sessions">No session audio found in the output folder.</div>}
                  </div>
                  <div className="session-footer">
                    <div className="dropzone compact" onDragOver={(event) => event.preventDefault()} onDrop={dropAudio}>
                      Drop external audio
                    </div>
                    <button className="icon-button" title="Choose external audio" aria-label="Choose external audio" onClick={pickAudio}>
                      <AudioFileIcon />
                    </button>
                  </div>
                </section>

                <div
                  className="pane-divider"
                  role="separator"
                  aria-label="Resize session list"
                  aria-orientation="vertical"
                  aria-valuemin={Math.min(220, Math.max(160, (transcribeLibraryWidth || 680) - 240))}
                  aria-valuemax={Math.max(160, (transcribeLibraryWidth || 680) - 228)}
                  aria-valuenow={effectiveSessionListWidth}
                  tabIndex={0}
                  onPointerDown={beginSessionResize}
                  onKeyDown={handleSessionDividerKey}
                />

                <section className="selected-session">
                  <div className="section-head">
                    <h3>Selected Session</h3>
                    {selectedSession && (
                      <button
                        className="tiny-icon light"
                        title="Open session folder"
                        aria-label="Open session folder"
                        onClick={() => window.meetingApi.openPath(selectedSession.folderPath)}
                      >
                        <OutputActionIcon action="open" />
                      </button>
                    )}
                  </div>
                  <div className="selected-audio">
                    <strong>{selectedSession?.name || "External audio"}</strong>
                    <small>{selectedAudioPath || "Choose a session or external audio file."}</small>
                  </div>
                  <div className="qwen-settings">
                    <div className="qwen-settings-head">
                      <strong>Qwen settings</strong>
                    </div>
                    <div className="qwen-setting-fields">
                    <label className="field">
                      <span>Chunk</span>
                      <input type="number" min="10" value={qwenChunkSeconds} onChange={(event) => setQwenChunkSeconds(Number(event.target.value))} />
                    </label>
                    <label className="field">
                      <span>Tokens</span>
                      <input type="number" min="256" value={qwenTokens} onChange={(event) => setQwenTokens(Number(event.target.value))} />
                    </label>
                    <label className="field">
                      <span>Batch</span>
                      <input type="number" min="1" value={qwenBatch} onChange={(event) => setQwenBatch(Number(event.target.value))} />
                    </label>
                    </div>
                  </div>
                  <div className="run-block">
                    <div className="run-block-head">
                      <strong>Run transcription</strong>
                      <small>Selected audio</small>
                    </div>
                    <div className="grid-actions">
                      <button disabled={!selectedAudioPath || isRunning} onClick={() => run("cpp-cpu", { audioPath: selectedAudioPath })}>CPP CPU</button>
                      <button disabled={!selectedAudioPath || isRunning} onClick={() => run("cpp-gpu", { audioPath: selectedAudioPath })}>CPP GPU</button>
                      <button disabled={!selectedAudioPath || isRunning} onClick={() => run("qwen-cpu", qwenArgs)}>Qwen CPU</button>
                      <button disabled={!selectedAudioPath || isRunning} onClick={() => run("qwen-gpu", qwenArgs)}>Qwen GPU</button>
                    </div>
                  </div>
                  <div className={`run-progress ${isRunning ? "running" : "idle"}`}>
                    <div>
                      <strong>{isRunning ? activeLabel || "Running" : "Idle"}</strong>
                      <small>{isRunning ? `Elapsed ${formatElapsed(elapsedSeconds)}` : "Progress appears here while transcription runs."}</small>
                    </div>
                    <span />
                  </div>
                  {lastOutputPath && (
                    <button className="output-path" onClick={() => window.meetingApi.openPath(lastOutputPath)}>
                      Open latest target: {lastOutputPath}
                    </button>
                  )}
                </section>
              </section>
            )}

            {tab === "setup" && (
              <section className="stack">
                <h3>Asset status</h3>
                <div className="asset-list">
                  {assets.map((asset) => {
                    const download = assetDownloads[asset.id];
                    const isDownloading = download?.running === true;
                    return (
                      <div key={asset.relativePath} className="asset-row">
                        <span className={asset.exists ? "ok-dot" : isDownloading ? "busy-dot" : "bad-dot"} />
                        <div className="asset-main">
                          <strong>{asset.label}</strong>
                          <small>{asset.relativePath}</small>
                          {download && (
                            <div className={`asset-progress ${isDownloading ? "running" : ""}`}>
                              <span>
                                <i style={{ width: `${download.percent}%` }} />
                              </span>
                              <small>{download.text}</small>
                            </div>
                          )}
                        </div>
                        <button
                          className="asset-download"
                          title={isDownloading ? `Pause ${asset.label}` : `Download ${asset.label}`}
                          aria-label={isDownloading ? `Pause ${asset.label}` : `Download ${asset.label}`}
                          onClick={() => downloadAsset(asset.id)}
                        >
                          {isDownloading ? <PauseIcon /> : <DownloadIcon />}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="setup-actions" aria-label="Setup actions">
                  <button title="Refresh status" aria-label="Refresh status" onClick={refreshAssets}>↻</button>
                  <button title="Download missing assets" aria-label="Download missing assets" onClick={downloadMissingAssets}>↓</button>
                  <button title="Open outputs" aria-label="Open outputs" onClick={() => window.meetingApi.openPath(outputDir.trim() || "outputs")}>▣</button>
                </div>
                <section className="output-settings">
                  <h3>Output folder</h3>
                  <div className="output-folder-row">
                    <input value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="outputs" />
                    <div className="output-icon-actions" aria-label="Output folder actions">
                      <button className="icon-button" title="Choose output folder" aria-label="Choose output folder" onClick={pickOutputFolder}>
                        <OutputActionIcon action="choose" />
                      </button>
                      <button className="icon-button" title="Open output folder" aria-label="Open output folder" onClick={() => window.meetingApi.openPath(outputDir.trim() || "outputs")}>
                        <OutputActionIcon action="open" />
                      </button>
                      <button className="icon-button" title="Reset output folder" aria-label="Reset output folder" onClick={() => setOutputDir("outputs")}>
                        <OutputActionIcon action="reset" />
                      </button>
                    </div>
                  </div>
                </section>
              </section>
            )}
            </div>
          </section>

          {tab === "transcribe" && (
            <div
              className="pane-divider workspace-divider"
              role="separator"
              aria-label="Resize output panel"
              aria-orientation="vertical"
              aria-valuemin={Math.min(520, Math.max(420, (workspaceWidth || 900) - 304))}
              aria-valuemax={Math.max(520, (workspaceWidth || 900) - 304)}
              aria-valuenow={effectiveTranscribeColumnWidth}
              tabIndex={0}
              onPointerDown={beginOutputResize}
              onKeyDown={handleOutputDividerKey}
            />
          )}

          <aside className="output-column">
            <div className="output-spacer">
              {tab === "setup" && (
                <section className="audio-settings">
                  <div className="audio-settings-head">
                    <div className="audio-settings-title">
                      <strong>Audio input</strong>
                      {audioDevices?.error && <small>{audioDevices.error}</small>}
                    </div>
                    <div className="audio-head-actions">
                      <label className="mic-toggle">
                        <input type="checkbox" checked={includeMic} onChange={(event) => setIncludeMic(event.target.checked)} />
                        <span>Mic</span>
                      </label>
                      <button className="tiny-icon" title="Refresh audio devices" aria-label="Refresh audio devices" onClick={refreshAudioDevices}>↻</button>
                    </div>
                  </div>
                  <div className="audio-row speaker-row">
                    <span className="audio-dot" />
                    <div title={audioDevices?.defaultSpeaker || "Default loopback"}>
                      <strong>Speaker</strong>
                      <small>{audioDevices?.defaultSpeaker || "Default loopback"}</small>
                    </div>
                    <label className="device-select" title="Choose speaker loopback">
                      <select value={systemDevice} onChange={(event) => setSystemDevice(event.target.value)} aria-label="Choose speaker loopback">
                        <option value="">Default</option>
                        {audioDevices?.loopbacks.map((device) => (
                          <option key={device.id || device.name} value={device.id || device.name}>{device.name}</option>
                        ))}
                      </select>
                      <span aria-hidden="true" />
                    </label>
                  </div>
                  <div className="audio-row mic-row">
                    <span className={includeMic ? "audio-dot" : "audio-dot off"} />
                    <div title={includeMic ? audioDevices?.defaultMicrophone || "Default microphone" : "Off"}>
                      <strong>Microphone</strong>
                      <small>{includeMic ? audioDevices?.defaultMicrophone || "Default microphone" : "Off"}</small>
                    </div>
                    <label className="device-select" title="Choose microphone">
                      <select disabled={!includeMic} value={micDevice} onChange={(event) => setMicDevice(event.target.value)} aria-label="Choose microphone">
                        <option value="">Default</option>
                        {audioDevices?.microphones.map((device) => (
                          <option key={device.id || device.name} value={device.id || device.name}>{device.name}</option>
                        ))}
                      </select>
                      <span aria-hidden="true" />
                    </label>
                  </div>
                </section>
              )}
            </div>
            <div className="live-box">
              <div className="live-box-head">
                <strong>{tab === "live" ? "Live transcript" : "Current output"}</strong>
                {tab === "live" && liveTranscriptPath && <button onClick={() => window.meetingApi.openPath(liveTranscriptPath)}>Open file</button>}
                {tab !== "live" && lastOutputPath && <button onClick={() => window.meetingApi.openPath(lastOutputPath)}>Open file</button>}
              </div>
              <pre ref={outputRef}>
                {tab === "live"
                  ? liveTranscript || "Waiting for transcript lines..."
                  : lastOutputPath || "Output path will appear after you start a job."}
              </pre>
              {tab === "live" && liveTranscriptPath && <small>{liveTranscriptPath}</small>}
            </div>

            <aside className="logs">
              <div className="logs-head">
                <h3>Process log</h3>
                <button onClick={() => setLogs([])}>Clear</button>
              </div>
              <pre ref={logsRef}>
                {logs.map((line) => (
                  <span key={line.id} className={line.kind}>{line.text}</span>
                ))}
              </pre>
            </aside>
          </aside>
        </section>
      </section>
    </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
