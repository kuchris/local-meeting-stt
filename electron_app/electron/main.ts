import type { BrowserWindow as BrowserWindowType } from "electron";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
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

const repoRoot = path.resolve(process.cwd(), "..");
const electronDataDir = path.join(repoRoot, ".electron-user-data");
const running = new Map<number, ChildProcessWithoutNullStreams>();
let nextProcessId = 1;
let mainWindow: BrowserWindowType | null = null;

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

function runCmd(script: string, args: string[] = []): { executable: string; args: string[] } {
  return { executable: "cmd.exe", args: ["/c", script, ...args] };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
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

  switch (kind) {
    case "live-meeting": {
      const extra = [...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live meeting", ...runCmd("live_meeting.cmd", extra) };
    }
    case "live-whisper": {
      const extra = [...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live transcript", ...runCmd("live_transcribe.cmd", extra) };
    }
    case "live-cpp-gpu": {
      const extra = [...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live whisper.cpp GPU", ...runCmd(path.join("whisper_cpp", "live_cpp.cmd"), extra) };
    }
    case "live-cpp-cpu": {
      const extra = [...captureArgs(args)];
      if (chunkSeconds) extra.push("--chunk-seconds", chunkSeconds);
      return { label: "Live whisper.cpp CPU", ...runCmd(path.join("whisper_cpp", "live_cpp_cpu.cmd"), extra) };
    }
    case "record-enter":
      return { label: "Record until Enter", ...runCmd("record_meeting.cmd", ["--until-enter", ...captureArgs(args)]) };
    case "record-timed": {
      const duration = num(args.durationSeconds) ?? "3600";
      return { label: "Timed recording", ...runCmd("record_meeting.cmd", ["--duration", duration, ...captureArgs(args)]) };
    }
    case "cpp-gpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputBase = audioPath.replace(/\.[^.\\/]+$/, "_cpp_gpu_transcript");
      return {
        label: "whisper.cpp GPU",
        executable: path.join(repoRoot, "whisper_cpp", "bin_cuda", "Release", "whisper-cli.exe"),
        args: ["-m", path.join(repoRoot, "whisper_cpp", "models", "ggml-small.bin"), "-f", audioPath, "-l", "ja", "-otxt", "-of", outputBase]
      };
    }
    case "cpp-cpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputBase = audioPath.replace(/\.[^.\\/]+$/, "_cpp_cpu_transcript");
      return {
        label: "whisper.cpp CPU",
        executable: path.join(repoRoot, "whisper_cpp", "bin_cpu", "Release", "whisper-cli.exe"),
        args: ["-m", path.join(repoRoot, "whisper_cpp", "models", "ggml-small.bin"), "-f", audioPath, "-l", "ja", "-otxt", "-of", outputBase, "-t", "16"]
      };
    }
    case "qwen-gpu": {
      if (!audioPath) throw new Error("Choose an audio file first.");
      const outputPath = audioPath.replace(/\.[^.\\/]+$/, "_qwen_gpu_transcript.txt");
      const commandArgs = ["post_transcribe_qwen.py", audioPath, "-o", outputPath, "--device", "cuda:0"];
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
      const outputPath = audioPath.replace(/\.[^.\\/]+$/, "_qwen_cpu_transcript.txt");
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
          "post_transcribe_qwen.py",
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
      return { label: "Download assets", executable: "uv", args: ["run", "--with", "huggingface-hub", "python", "download_assets.py"] };
    default:
      throw new Error(`Unknown command: ${kind}`);
  }
}

function terminateProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true });
    killer.on("close", () => resolve());
    killer.on("error", () => resolve());
  });
}

function collectProcessOutput(executable: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: repoRoot,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" }
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
    env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" }
  });

  running.set(processId, child);
  sendProcessEvent({ type: "start", processId, label: command.label, command: `${command.executable} ${command.args.join(" ")}` });

  child.stdout.on("data", (data) => sendProcessEvent({ type: "stdout", processId, text: data.toString() }));
  child.stderr.on("data", (data) => sendProcessEvent({ type: "stderr", processId, text: data.toString() }));
  child.on("close", (code, signal) => {
    running.delete(processId);
    sendProcessEvent({ type: "exit", processId, code, signal });
  });
  child.on("error", (error) => {
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
    running.delete(processId);
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

ipcMain.handle("open-path", async (_, targetPath: string) => {
  if (!targetPath) return { ok: false };
  if (/^https?:\/\//.test(targetPath)) {
    await shell.openExternal(targetPath);
    return { ok: true };
  }
  await shell.openPath(path.resolve(repoRoot, targetPath));
  return { ok: true };
});

ipcMain.handle("check-assets", async () => {
  const assets = [
    ["Qwen3-ASR", "models/Qwen3-ASR-0.6B"],
    ["faster-whisper small", "models/faster-whisper-small"],
    ["whisper.cpp CPU", "whisper_cpp/bin_cpu/Release/whisper-cli.exe"],
    ["whisper.cpp CUDA", "whisper_cpp/bin_cuda/Release/whisper-cli.exe"],
    ["whisper.cpp small model", "whisper_cpp/models/ggml-small.bin"]
  ];
  return assets.map(([label, relativePath]) => ({
    label,
    relativePath,
    exists: existsSync(path.join(repoRoot, relativePath))
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
    "record_audio.py",
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
