import type { BrowserWindow as BrowserWindowType } from "electron";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";

type CommandArgs = Record<string, unknown>;
type AudioDevice = { name: string; id: string; kind: "loopback" | "mic" };
type AudioDeviceStatus = {
  defaultSpeaker: string;
  defaultMicrophone: string;
  loopbacks: AudioDevice[];
  microphones: AudioDevice[];
  error?: string;
};
type OutputSession = {
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
type AppSettings = {
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
type AssetDownloadEvent =
  | { type: "start"; assetId: string; label: string }
  | { type: "progress"; assetId: string; percent: number; text: string }
  | { type: "stdout"; assetId: string; text: string }
  | { type: "stderr"; assetId: string; text: string }
  | { type: "exit"; assetId: string; code: number | null; signal: string | null };

function isRepoRoot(candidate: string): boolean {
  return existsSync(path.join(candidate, "python_backend", "record_audio.py"));
}

function resolveRepoRoot(): string {
  const exeDir = path.dirname(process.execPath);
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const portableFileDir = process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : undefined;
  const candidates = [
    process.env.LOCAL_MEETING_STT_ROOT,
    portableDir,
    portableDir ? path.resolve(portableDir, "..") : undefined,
    portableDir ? path.resolve(portableDir, "..", "..") : undefined,
    portableDir ? path.resolve(portableDir, "..", "..", "..") : undefined,
    portableFileDir,
    portableFileDir ? path.resolve(portableFileDir, "..") : undefined,
    portableFileDir ? path.resolve(portableFileDir, "..", "..") : undefined,
    portableFileDir ? path.resolve(portableFileDir, "..", "..", "..") : undefined,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "..", ".."),
    path.resolve(process.cwd(), "..", "..", ".."),
    path.resolve(exeDir, ".."),
    path.resolve(exeDir, "..", ".."),
    path.resolve(exeDir, "..", "..", "..")
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isRepoRoot) ?? path.resolve(process.cwd(), "..");
}

function resolveDataRoot(repoRoot: string): string {
  const portableFileDir = process.env.PORTABLE_EXECUTABLE_FILE ? path.dirname(process.env.PORTABLE_EXECUTABLE_FILE) : undefined;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const exeDir = path.dirname(process.execPath);
  const candidates = [process.env.LOCAL_MEETING_STT_DATA_ROOT, portableFileDir, portableDir, exeDir].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "settings.json"))) return candidate;
  }
  return repoRoot;
}

const repoRoot = resolveRepoRoot();
const dataRoot = resolveDataRoot(repoRoot);
const runtimeDir = path.join(dataRoot, "runtime");
const electronDataDir = path.join(runtimeDir, "electron-user-data");
const appIconPath = path.join(repoRoot, "electron_app", "build", "icon.png");
const settingsPath = path.join(dataRoot, "settings.json");
const running = new Map<number, ChildProcessWithoutNullStreams>();
const assetDownloads = new Map<string, ChildProcessWithoutNullStreams>();
const recordingPaths = new Map<number, Set<string>>();
let nextProcessId = 1;
let mainWindow: BrowserWindowType | null = null;

mkdirSync(electronDataDir, { recursive: true });
mkdirSync(path.join(runtimeDir, "uv-cache"), { recursive: true });
mkdirSync(path.join(runtimeDir, "venv"), { recursive: true });
app.setPath("userData", electronDataDir);
app.commandLine.appendSwitch("disk-cache-dir", path.join(electronDataDir, "cache"));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 740,
    minWidth: 1180,
    minHeight: 660,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    frame: false,
    title: "Local Meeting STT",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function sendProcessEvent(event: unknown): void {
  mainWindow?.webContents.send("process-event", event);
}

function sendAssetDownloadEvent(event: AssetDownloadEvent): void {
  mainWindow?.webContents.send("asset-download-event", event);
}

function processEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    UV_CACHE_DIR: path.join(runtimeDir, "uv-cache"),
    UV_PROJECT_ENVIRONMENT: path.join(runtimeDir, "venv")
  };
}

function defaultSettings(): AppSettings {
  return {
    outputDir: "outputs",
    qwen: {
      chunkSeconds: 60,
      tokens: 4096,
      batch: 4
    },
    ui: {
      sessionListWidth: 300,
      transcribeColumnWidth: 560
    }
  };
}

function readSettings(): AppSettings {
  if (!existsSync(settingsPath)) {
    const settings = defaultSettings();
    writeSettings(settings);
    return settings;
  }
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as AppSettings;
  } catch {
    return defaultSettings();
  }
}

function writeSettings(settings: AppSettings): void {
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function runCmd(script: string, args: string[] = []): { executable: string; args: string[] } {
  return { executable: "cmd.exe", args: ["/c", script, ...args] };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function logicalThreadCount(): number {
  return Math.max(1, cpus().length);
}

function liveThreadCount(): string {
  const threads = logicalThreadCount();
  if (threads <= 4) return String(threads);
  if (threads <= 8) return "4";
  if (threads <= 16) return "6";
  return "8";
}

function postThreadCount(): string {
  const threads = logicalThreadCount();
  if (threads <= 4) return String(threads);
  if (threads <= 8) return "6";
  if (threads <= 16) return "10";
  return "16";
}

function resolveOutputDir(args: CommandArgs): string {
  const configured = str(args.outputDir) ?? "outputs";
  const outputDir = path.isAbsolute(configured) ? configured : path.resolve(dataRoot, configured);
  mkdirSync(outputDir, { recursive: true });
  return outputDir;
}

function timestampedOutputDir(outputDir: string, prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
  const sessionDir = path.join(outputDir, `${prefix}_${stamp}`);
  mkdirSync(sessionDir, { recursive: true });
  return sessionDir;
}

function transcriptOutputPath(audioPath: string, outputDir: string, suffix: string): string {
  const audioDir = path.dirname(audioPath);
  const sourceName = path.basename(audioPath).replace(/\.[^.\\/]+$/, "");
  if (path.basename(audioPath).toLowerCase() === "audio.wav") {
    return path.join(audioDir, `${suffix}.txt`);
  }
  return path.join(outputDir, `${sourceName}_${suffix}.txt`);
}

function captureArgs(args: CommandArgs): string[] {
  const systemDevice = str(args.systemDevice);
  const micDevice = str(args.micDevice);
  const extra: string[] = [];

  if (systemDevice) extra.push("--system-device", systemDevice);
  if (args.includeMic === true) {
    extra.push("--include-mic");
    if (micDevice) extra.push("--mic-device", micDevice);
  }

  return extra;
}

function buildCommand(kind: string, args: CommandArgs): { label: string; executable: string; args: string[] } {
  const audioPath = str(args.audioPath);
  const chunkSeconds = num(args.chunkSeconds);
  const qwenTokens = num(args.qwenTokens);
  const qwenBatch = num(args.qwenBatch);
  const outputDir = resolveOutputDir(args);

  switch (kind) {
    case "live-meeting": {
      const extra = ["--recording-dir", outputDir, ...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live meeting", ...runCmd(path.join("python_backend", "live_meeting.cmd"), extra) };
    }
    case "live-whisper": {
      const outputPath = path.join(timestampedOutputDir(outputDir, "live_text"), "live_transcript.txt");
      const extra = ["--output", outputPath, ...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live transcript", ...runCmd(path.join("python_backend", "live_transcribe.cmd"), extra) };
    }
    case "live-cpp-gpu": {
      const extra = ["--recording-dir", outputDir, ...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live whisper.cpp GPU", ...runCmd(path.join("whisper_cpp", "live_cpp.cmd"), extra) };
    }
    case "live-cpp-cpu": {
      const extra = ["--recording-dir", outputDir, "--threads", liveThreadCount(), ...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live whisper.cpp CPU", ...runCmd(path.join("whisper_cpp", "live_cpp_cpu.cmd"), extra) };
    }
    case "live-cpp-server-cpu": {
      const extra = ["--recording-dir", outputDir, "--threads", liveThreadCount(), ...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live whisper.cpp server CPU", ...runCmd(path.join("whisper_cpp", "live_cpp_server_cpu.cmd"), extra) };
    }
    case "record-enter":
      return { label: "Record until Enter", ...runCmd(path.join("python_backend", "record_meeting.cmd"), ["--until-enter", "--output", path.join(timestampedOutputDir(outputDir, "meeting"), "audio.wav"), ...captureArgs(args)]) };
    case "record-timed": {
      const duration = num(args.durationSeconds) ?? "3600";
      return { label: "Timed recording", ...runCmd(path.join("python_backend", "record_meeting.cmd"), ["--duration", duration, "--output", path.join(timestampedOutputDir(outputDir, "meeting"), "audio.wav"), ...captureArgs(args)]) };
    }
    case "cpp-gpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputBase = transcriptOutputPath(audioPath, outputDir, "cpp_gpu_transcript").replace(/\.txt$/, "");
      return {
        label: "whisper.cpp GPU",
        executable: path.join(dataRoot, "whisper_cpp", "bin_cuda", "Release", "whisper-cli.exe"),
        args: ["-m", path.join(dataRoot, "whisper_cpp", "models", "ggml-small.bin"), "-f", audioPath, "-l", "ja", "-otxt", "-of", outputBase]
      };
    }
    case "cpp-cpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputBase = transcriptOutputPath(audioPath, outputDir, "cpp_cpu_transcript").replace(/\.txt$/, "");
      return {
        label: "whisper.cpp CPU",
        executable: path.join(dataRoot, "whisper_cpp", "bin_cpu", "Release", "whisper-cli.exe"),
        args: ["-m", path.join(dataRoot, "whisper_cpp", "models", "ggml-small.bin"), "-f", audioPath, "-l", "ja", "-otxt", "-of", outputBase, "-t", postThreadCount()]
      };
    }
    case "qwen-gpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputPath = transcriptOutputPath(audioPath, outputDir, "qwen_gpu_transcript");
      const commandArgs = ["python_backend/post_transcribe_qwen.py", audioPath, "-o", outputPath, "--device", "cuda:0"];
      if (qwenTokens) commandArgs.push("--max-new-tokens", qwenTokens);
      if (chunkSeconds) commandArgs.push("--chunk-seconds", chunkSeconds);
      if (qwenBatch) commandArgs.push("--batch-size", qwenBatch);
      return {
        label: "Qwen GPU",
        executable: "uv",
        args: [
          "run",
          "--python",
          "3.12",
          "--index-strategy",
          "unsafe-best-match",
          "--index-url",
          "https://download.pytorch.org/whl/cu121",
          "--extra-index-url",
          "https://pypi.org/simple",
          "--with",
          "qwen-asr",
          "--with",
          "torch==2.5.1+cu121",
          "--with",
          "torchvision==0.20.1+cu121",
          "python",
          ...commandArgs
        ]
      };
    }
    case "qwen-cpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputPath = transcriptOutputPath(audioPath, outputDir, "qwen_cpu_transcript");
      return {
        label: "Qwen CPU",
        executable: "uv",
        args: [
          "run",
          "--python",
          "3.12",
          "--with",
          "qwen-asr",
          "--with",
          "torch",
          "--with",
          "torchvision",
          "python",
          "python_backend/post_transcribe_qwen.py",
          audioPath,
          "-o",
          outputPath,
          "--device",
          "cpu",
          "--max-new-tokens",
          qwenTokens ?? "4096",
          "--chunk-seconds",
          chunkSeconds ?? "60",
          "--batch-size",
          qwenBatch ?? "4"
        ]
      };
    }
    case "download-assets":
      return { label: "Download assets", executable: "uv", args: ["run", "--with", "huggingface-hub", "python", "python_backend/download_assets.py", "--target-root", dataRoot] };
    case "download-asset": {
      const assetId = str(args.assetId);
      if (!assetId) throw new Error("Missing asset id.");
      return { label: `Download ${assetId}`, executable: "uv", args: ["run", "--with", "huggingface-hub", "python", "python_backend/download_assets.py", "--target-root", dataRoot, "--only", assetId] };
    }
    default:
      throw new Error(`Unknown command: ${kind}`);
  }
}

function assetLabel(assetId: string): string {
  const labels: Record<string, string> = {
    qwen: "Qwen3-ASR",
    "faster-whisper": "faster-whisper small",
    "whisper-cpp-cpu": "whisper.cpp CPU",
    "whisper-cpp-cuda": "whisper.cpp CUDA",
    "whisper-cpp-model": "whisper.cpp small model"
  };
  return labels[assetId] ?? assetId;
}

function buildAssetDownloadCommand(assetId: string): { label: string; executable: string; args: string[] } {
  return {
    label: assetLabel(assetId),
    executable: "uv",
    args: ["run", "--with", "huggingface-hub", "python", "python_backend/download_assets.py", "--target-root", dataRoot, "--only", assetId]
  };
}

function parseAssetProgress(assetId: string, text: string): AssetDownloadEvent[] {
  const events: AssetDownloadEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^ASSET_PROGRESS\s+(\S+)\s+(\d{1,3})\s*(.*)$/);
    if (!match || match[1] !== assetId) continue;
    events.push({
      type: "progress",
      assetId,
      percent: Math.min(100, Math.max(0, Number(match[2]))),
      text: match[3]?.trim() || ""
    });
  }
  return events;
}

function terminateProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

function rememberRecordingPath(processId: number, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^Recording:\s*(.+\.wav)\s*$/i);
    if (!match) continue;
    const recordingPath = path.isAbsolute(match[1]) ? match[1] : path.resolve(repoRoot, match[1]);
    const paths = recordingPaths.get(processId) ?? new Set<string>();
    paths.add(recordingPath);
    recordingPaths.set(processId, paths);
  }
}

function repairPcmWavHeader(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const size = statSync(filePath).size;
  if (size <= 44 || size > 0xffffffff) return false;

  const fd = openSync(filePath, "r+");
  try {
    const header = Buffer.alloc(44);
    if (readSync(fd, header, 0, header.length, 0) !== header.length) return false;
    if (header.toString("ascii", 0, 4) !== "RIFF") return false;
    if (header.toString("ascii", 8, 12) !== "WAVE") return false;
    if (header.toString("ascii", 12, 16) !== "fmt ") return false;
    if (header.toString("ascii", 36, 40) !== "data") return false;
    if (header.readUInt16LE(20) !== 1) return false;

    const expectedRiffSize = size - 8;
    const expectedDataSize = size - 44;
    if (header.readUInt32LE(4) === expectedRiffSize && header.readUInt32LE(40) === expectedDataSize) return false;

    const patch = Buffer.alloc(8);
    patch.writeUInt32LE(expectedRiffSize, 0);
    patch.writeUInt32LE(expectedDataSize, 4);
    writeSync(fd, patch.subarray(0, 4), 0, 4, 4);
    writeSync(fd, patch.subarray(4, 8), 0, 4, 40);
    return true;
  } finally {
    closeSync(fd);
  }
}

function repairRecordedWavs(processId: number): void {
  const paths = recordingPaths.get(processId);
  if (!paths) return;
  recordingPaths.delete(processId);
  for (const recordingPath of paths) {
    try {
      if (repairPcmWavHeader(recordingPath)) {
        sendProcessEvent({ type: "stdout", processId, text: `Repaired WAV header: ${recordingPath}\n` });
      }
    } catch (error) {
      sendProcessEvent({ type: "stderr", processId, text: `Could not repair WAV header: ${recordingPath}\n${error instanceof Error ? error.message : String(error)}\n` });
    }
  }
}

function collectProcessOutput(executable: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      windowsHide: true,
      env: processEnv()
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

function parseAudioDevices(output: string): AudioDeviceStatus {
  const status: AudioDeviceStatus = {
    defaultSpeaker: "",
    defaultMicrophone: "",
    loopbacks: [],
    microphones: []
  };
  let pending: AudioDevice | null = null;

  for (const line of output.split(/\r?\n/)) {
    const defaultSpeaker = line.match(/^Default speaker:\s*(.+)$/);
    if (defaultSpeaker) status.defaultSpeaker = defaultSpeaker[1].trim();

    const defaultMicrophone = line.match(/^Default microphone:\s*(.+)$/);
    if (defaultMicrophone) status.defaultMicrophone = defaultMicrophone[1].trim();

    const device = line.match(/^\s*\d+\s+\[(loopback|mic)\]\s+(.+)$/);
    if (device) {
      pending = { kind: device[1] as AudioDevice["kind"], name: device[2].trim(), id: "" };
      if (pending.kind === "loopback") status.loopbacks.push(pending);
      if (pending.kind === "mic") status.microphones.push(pending);
      continue;
    }

    const id = line.match(/^\s*id:\s*(.+)$/);
    if (id && pending) pending.id = id[1].trim();
  }

  return status;
}

ipcMain.handle("run-command", async (_, kind: string, rawArgs: CommandArgs = {}) => {
  const command = buildCommand(kind, rawArgs);
  const processId = nextProcessId++;
  const child = spawn(command.executable, command.args, {
    cwd: repoRoot,
    windowsHide: true,
    env: processEnv()
  });

  running.set(processId, child);
  sendProcessEvent({ type: "start", processId, label: command.label, command: `${command.executable} ${command.args.join(" ")}` });

  child.stdout.on("data", (data) => {
    const text = data.toString();
    rememberRecordingPath(processId, text);
    sendProcessEvent({ type: "stdout", processId, text });
  });
  child.stderr.on("data", (data) => sendProcessEvent({ type: "stderr", processId, text: data.toString() }));
  child.on("close", (code, signal) => {
    repairRecordedWavs(processId);
    running.delete(processId);
    sendProcessEvent({ type: "exit", processId, code, signal });
  });
  child.on("error", (error) => {
    repairRecordedWavs(processId);
    running.delete(processId);
    sendProcessEvent({ type: "stderr", processId, text: `${error.message}\n` });
    sendProcessEvent({ type: "exit", processId, code: 1, signal: null });
  });

  return { processId, label: command.label };
});

ipcMain.handle("stop-command", async (_, processId: number) => {
  const child = running.get(processId);
  if (child?.pid) {
    await terminateProcessTree(child.pid);
    repairRecordedWavs(processId);
    running.delete(processId);
    return { stopped: true };
  }
  return { stopped: false };
});

ipcMain.handle("start-asset-download", async (_, assetId: string) => {
  if (assetDownloads.has(assetId)) return { started: false, assetId };
  const command = buildAssetDownloadCommand(assetId);
  const child = spawn(command.executable, command.args, {
    cwd: repoRoot,
    windowsHide: true,
    env: processEnv()
  });

  assetDownloads.set(assetId, child);
  sendAssetDownloadEvent({ type: "start", assetId, label: command.label });
  sendAssetDownloadEvent({ type: "progress", assetId, percent: 1, text: "Starting" });

  child.stdout.on("data", (data) => {
    const text = data.toString();
    for (const event of parseAssetProgress(assetId, text)) sendAssetDownloadEvent(event);
    sendAssetDownloadEvent({ type: "stdout", assetId, text });
  });
  child.stderr.on("data", (data) => sendAssetDownloadEvent({ type: "stderr", assetId, text: data.toString() }));
  child.on("close", (code, signal) => {
    assetDownloads.delete(assetId);
    if (code === 0) sendAssetDownloadEvent({ type: "progress", assetId, percent: 100, text: "Done" });
    sendAssetDownloadEvent({ type: "exit", assetId, code, signal });
  });
  child.on("error", (error) => {
    assetDownloads.delete(assetId);
    sendAssetDownloadEvent({ type: "stderr", assetId, text: `${error.message}\n` });
    sendAssetDownloadEvent({ type: "exit", assetId, code: 1, signal: null });
  });

  return { started: true, assetId };
});

ipcMain.handle("stop-asset-download", async (_, assetId: string) => {
  const child = assetDownloads.get(assetId);
  if (child?.pid) {
    await terminateProcessTree(child.pid);
    assetDownloads.delete(assetId);
    sendAssetDownloadEvent({ type: "progress", assetId, percent: 0, text: "Paused" });
    return { stopped: true };
  }
  return { stopped: false };
});

ipcMain.handle("pick-audio-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select audio file",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "flac", "ogg"] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("pick-output-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select output folder",
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("load-settings", async () => readSettings());

ipcMain.handle("save-settings", async (_, settings: AppSettings) => {
  writeSettings(settings);
  return { ok: true, path: settingsPath };
});

ipcMain.handle("list-output-sessions", async (_, rawOutputDir: string) => {
  const outputDir = path.isAbsolute(rawOutputDir) ? rawOutputDir : path.resolve(dataRoot, rawOutputDir || "outputs");
  if (!existsSync(outputDir)) return [];

  const sessions: OutputSession[] = [];
  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(outputDir, entry.name);
    const audioPath = path.join(folderPath, "audio.wav");
    if (!existsSync(audioPath)) continue;
    const audioStats = statSync(audioPath);
    sessions.push({
      id: folderPath,
      name: entry.name,
      folderPath,
      audioPath,
      audioSize: audioStats.size,
      modifiedTime: audioStats.mtimeMs,
      transcripts: {
        live: existsSync(path.join(folderPath, "live_transcript.txt")),
        cppCpu: existsSync(path.join(folderPath, "cpp_cpu_transcript.txt")),
        cppGpu: existsSync(path.join(folderPath, "cpp_gpu_transcript.txt")),
        qwenCpu: existsSync(path.join(folderPath, "qwen_cpu_transcript.txt")),
        qwenGpu: existsSync(path.join(folderPath, "qwen_gpu_transcript.txt"))
      }
    });
  }

  return sessions.sort((left, right) => right.modifiedTime - left.modifiedTime);
});

ipcMain.handle("open-path", async (_, targetPath: string) => {
  if (!targetPath) return { ok: false };
  if (/^https?:\/\//.test(targetPath)) {
    await shell.openExternal(targetPath);
    return { ok: true };
  }
  const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(dataRoot, targetPath);
  if (!existsSync(resolvedPath) && !path.extname(resolvedPath)) {
    mkdirSync(resolvedPath, { recursive: true });
  }
  await shell.openPath(resolvedPath);
  return { ok: true };
});

ipcMain.handle("check-assets", async () => {
  const assets = [
    ["qwen", "Qwen3-ASR", "models/Qwen3-ASR-0.6B"],
    ["faster-whisper", "faster-whisper small", "models/faster-whisper-small"],
    ["whisper-cpp-cpu", "whisper.cpp CPU", "whisper_cpp/bin_cpu/Release/whisper-cli.exe"],
    ["whisper-cpp-cuda", "whisper.cpp CUDA", "whisper_cpp/bin_cuda/Release/whisper-cli.exe"],
    ["whisper-cpp-model", "whisper.cpp small model", "whisper_cpp/models/ggml-small.bin"]
  ];
  return assets.map(([id, label, relativePath]) => ({
    id,
    label,
    relativePath,
    exists: existsSync(path.join(dataRoot, relativePath))
  }));
});

ipcMain.handle("list-audio-devices", async () => {
  const result = await collectProcessOutput("uv", [
    "run",
    "--with",
    "soundcard",
    "--with",
    "soundfile",
    "--with",
    "numpy",
    "--with",
    "soxr",
    "python",
    "python_backend/record_audio.py",
    "--list-devices"
  ]);
  const status = parseAudioDevices(result.stdout);
  if (result.code !== 0) status.error = result.stderr || "Failed to list audio devices.";
  return status;
});

ipcMain.handle("window-control", async (_, action: string) => {
  if (!mainWindow) return { ok: false };
  if (action === "minimize") {
    mainWindow.minimize();
    return { ok: true };
  }
  if (action === "maximize") {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return { ok: true };
  }
  if (action === "close") {
    mainWindow.close();
    return { ok: true };
  }
  return { ok: false };
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);
}

app.on("window-all-closed", () => {
  for (const child of running.values()) {
    if (child.pid) void terminateProcessTree(child.pid);
  }
  if (process.platform !== "darwin") app.quit();
});
