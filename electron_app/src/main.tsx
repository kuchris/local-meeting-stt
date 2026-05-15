import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AssetStatus, AudioDeviceStatus, ProcessEvent } from "./types";
import "./styles.css";

type Tab = "live" | "record" | "transcribe" | "setup";

type LogLine = {
  id: number;
  processId: number;
  kind: "info" | "stdout" | "stderr" | "exit";
  text: string;
};

type MenuName = "file" | "run" | "view" | "window" | "help";

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
  const [lastOutputPath, setLastOutputPath] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveTranscriptPath, setLiveTranscriptPath] = useState("");
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const logsRef = useRef<HTMLPreElement | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  const isRunning = activeProcessId !== null;

  useEffect(() => {
    const unsubscribe = window.meetingApi.onProcessEvent((event) => {
      handleProcessEvent(event);
    });
    void refreshAssets();
    void refreshAudioDevices();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const logsElement = logsRef.current;
    if (logsElement) logsElement.scrollTop = logsElement.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const outputElement = outputRef.current;
    if (outputElement) outputElement.scrollTop = outputElement.scrollHeight;
  }, [liveTranscript, lastOutputPath, tab]);

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
    }
  }

  async function refreshAssets() {
    setAssets(await window.meetingApi.checkAssets());
  }

  async function refreshAudioDevices() {
    setAudioDevices(await window.meetingApi.listAudioDevices());
  }

  async function run(kind: string, args: Record<string, unknown> = {}) {
    try {
      updateExpectedOutput(kind);
      if (kind.startsWith("live-")) {
        setLiveTranscript("");
        setLiveTranscriptPath("");
      }
      await window.meetingApi.runCommand(kind, args);
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
    if (file) setAudioPath(file);
  }

  function updateExpectedOutput(kind: string) {
    const suffixes: Record<string, string> = {
      "cpp-gpu": "_cpp_gpu_transcript.txt",
      "cpp-cpu": "_cpp_cpu_transcript.txt",
      "qwen-gpu": "_qwen_gpu_transcript.txt",
      "qwen-cpu": "_qwen_cpu_transcript.txt"
    };
    const suffix = suffixes[kind];
    if (suffix && audioPath) {
      setLastOutputPath(audioPath.replace(/\.[^.\\/]+$/, suffix));
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
    if (file?.path) setAudioPath(file.path);
  }

  const qwenArgs = useMemo(
    () => ({ audioPath, chunkSeconds: qwenChunkSeconds, qwenTokens, qwenBatch }),
    [audioPath, qwenChunkSeconds, qwenTokens, qwenBatch]
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

  async function runMenuAction(action: string) {
    setOpenMenu(null);
    if (action === "open-audio") {
      await pickAudio();
      setTab("transcribe");
      return;
    }
    if (action === "open-recordings") {
      await window.meetingApi.openPath("recordings");
      return;
    }
    if (action === "open-cpp-output") {
      await window.meetingApi.openPath("whisper_cpp/output");
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
                <button onClick={() => void runMenuAction("open-recordings")}><span>Open Recordings</span></button>
                <button onClick={() => void runMenuAction("open-cpp-output")}><span>Open CPP Output</span></button>
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
        <section className={`workspace ${tab === "setup" ? "setup-workspace" : ""}`}>
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
              <section className="stack transcribe-stack">
                <h3>Audio file</h3>
                <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={dropAudio}>
                  Drop audio here
                </div>
                <div className="file-row">
                  <input value={audioPath} onChange={(event) => setAudioPath(event.target.value)} placeholder="Audio file path" />
                  <button onClick={pickAudio}>Choose</button>
                </div>
                <div className="advanced">
                  <label className="field">
                    <span>Qwen chunk seconds</span>
                    <input type="number" min="10" value={qwenChunkSeconds} onChange={(event) => setQwenChunkSeconds(Number(event.target.value))} />
                  </label>
                  <label className="field">
                    <span>Qwen tokens</span>
                    <input type="number" min="256" value={qwenTokens} onChange={(event) => setQwenTokens(Number(event.target.value))} />
                  </label>
                  <label className="field">
                    <span>Qwen batch</span>
                    <input type="number" min="1" value={qwenBatch} onChange={(event) => setQwenBatch(Number(event.target.value))} />
                  </label>
                </div>
                <div className="grid-actions">
                  <button disabled={!audioPath || isRunning} onClick={() => run("cpp-gpu", { audioPath })}>CPP GPU</button>
                  <button disabled={!audioPath || isRunning} onClick={() => run("cpp-cpu", { audioPath })}>CPP CPU</button>
                  <button disabled={!audioPath || isRunning} onClick={() => run("qwen-gpu", qwenArgs)}>Qwen GPU</button>
                  <button disabled={!audioPath || isRunning} onClick={() => run("qwen-cpu", qwenArgs)}>Qwen CPU</button>
                </div>
                {lastOutputPath && (
                  <button className="output-path" onClick={() => window.meetingApi.openPath(lastOutputPath)}>
                    Open latest target: {lastOutputPath}
                  </button>
                )}
              </section>
            )}

            {tab === "setup" && (
              <section className="stack">
                <h3>Asset status</h3>
                <div className="asset-list">
                  {assets.map((asset) => (
                    <div key={asset.relativePath} className="asset-row">
                      <span className={asset.exists ? "ok-dot" : "bad-dot"} />
                      <div>
                        <strong>{asset.label}</strong>
                        <small>{asset.relativePath}</small>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="setup-actions" aria-label="Setup actions">
                  <button title="Refresh status" aria-label="Refresh status" onClick={refreshAssets}>↻</button>
                  <button title="Download assets" aria-label="Download assets" disabled={isRunning} onClick={() => run("download-assets")}>↓</button>
                  <button title="Open recordings" aria-label="Open recordings" onClick={() => window.meetingApi.openPath("recordings")}>▣</button>
                  <button title="Open CPP output" aria-label="Open CPP output" onClick={() => window.meetingApi.openPath("whisper_cpp/output")}>⌘</button>
                </div>
              </section>
            )}
            </div>
          </section>

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
