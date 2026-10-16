// Local Meeting STT — the window's behaviour, without a framework.
//
// One state object; render() writes it to the page at most once per frame and
// only touches what changed. Captions and log lines never go through render():
// the Rust side sends small updates that are appended in place.

import { DEFAULT_LOCALE, isLocale, locales, localeNames, translate, translateError } from "./i18n.js";

const tauri = window.__TAURI__;
const invoke = (command, args) => tauri.core.invoke(command, args);
const appWindow = tauri.window.getCurrentWindow();

/* ───────────────────────── catalog ───────────────────────── */

/** Existing launch paths only. This catalog does not install or replace models. */
const liveModes = [
  { id: "live-meeting", model: "small", label: "faster-whisper", capture: true, optionalWav: true, assets: ["faster-whisper"] },
  { id: "live-cpp-gpu", model: "small", label: "whisper.cpp · CUDA（會議期間常駐）", capture: true, optionalWav: false, assets: ["whisper-cpp-model", "whisper-cpp-cuda"] },
  { id: "live-cpp-turbo-gpu", model: "turbo", label: "whisper.cpp · CUDA（會議期間常駐）", capture: true, optionalWav: false, assets: ["whisper-cpp-turbo-model", "whisper-cpp-cuda"] },
  { id: "live-cpp-cpu", model: "small", label: "whisper.cpp · CPU（會議期間常駐）", capture: true, optionalWav: false, assets: ["whisper-cpp-model", "whisper-cpp-cpu"] },
  { id: "live-cpp-server-vulkan", model: "small", label: "whisper.cpp · Vulkan", capture: true, optionalWav: false, assets: ["whisper-cpp-model", "whisper-cpp-vulkan"] },
  {
    id: "live-cpp-server-openvino", model: "small", label: "OpenVINO · NPU", capture: true, optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-openvino", "whisper-cpp-openvino-model-xml", "whisper-cpp-openvino-model-bin"],
  },
  {
    id: "live-cpp-server-openvino-gpu", model: "small", label: "OpenVINO · GPU", capture: true, optionalWav: false,
    assets: ["whisper-cpp-model", "whisper-cpp-openvino", "whisper-cpp-openvino-model-xml", "whisper-cpp-openvino-model-bin"],
  },
  { id: "live-cpp-stream-loopback-small", model: "small", label: "Vulkan loopback", capture: false, optionalWav: false, assets: ["whisper-cpp-model", "whisper-cpp-vulkan-loopback"] },
  { id: "live-cpp-stream-loopback-base", model: "base", label: "Vulkan loopback", capture: false, optionalWav: false, assets: ["whisper-cpp-base-model", "whisper-cpp-vulkan-loopback"] },
  { id: "live-sensevoice-gpu", model: "sensevoice", label: "sherpa-onnx · CUDA", capture: true, optionalWav: true, assets: ["sensevoice-small-gpu"] },
  { id: "live-sensevoice-cpu", model: "sensevoice", label: "sherpa-onnx · CPU", capture: true, optionalWav: true, assets: ["sensevoice-small"] },
];

/** What the recognizers are told; "auto" detects each utterance's language. */
const languages = [["auto", "自動偵測"], ["zh", "中文（普通話）"], ["yue", "粵語"], ["en", "lang.en"], ["ja", "lang.ja"]];
const isLanguage = (value) => languages.some(([id]) => id === value);
const chineseScripts = ["as-is", "traditional", "simplified"];
/** The transcript's lang attribute, so Han characters take that language's glyphs. */
function captionLang() {
  if (state.language === "ja") return "ja";
  if (state.language === "en") return "en";
  if (state.language === "zh") return state.chineseScript === "traditional" ? "zh-Hant" : "zh-Hans";
  if (state.language === "yue") return state.chineseScript === "simplified" ? "zh-Hans" : "zh-HK";
  return "";
}

const postBackends = {
  small: [["cpp-cpu", "CPU"], ["cpp-gpu", "CUDA"], ["cpp-vulkan", "Vulkan"], ["cpp-npu", "OpenVINO NPU"], ["cpp-openvino-gpu", "OpenVINO GPU"]],
  qwen: [["qwen-cpu", "CPU"], ["qwen-gpu", "CUDA"]],
  qwen17: [["qwen17-cpu", "CPU"], ["qwen17-gpu", "CUDA"]],
};
const postKinds = Object.values(postBackends).flat().map(([id]) => id);
const isPostKind = (value) => typeof value === "string" && postKinds.includes(value);
/** The model a post kind runs: "small", "qwen" (0.6B) or "qwen17" (1.7B). */
const postModelOf = (kind) => (kind.startsWith("qwen17") ? "qwen17" : kind.startsWith("qwen") ? "qwen" : "small");
/** Switching models keeps the CPU/CUDA choice. */
function switchPostModel(current, model) {
  const cuda = current === "cpp-gpu" || current === "qwen-gpu" || current === "qwen17-gpu";
  const prefix = { small: "cpp", qwen: "qwen", qwen17: "qwen17" }[model] ?? "cpp";
  return `${prefix}-${cuda ? "gpu" : "cpu"}`;
}
/** Model folders a Qwen transcription needs; the Whisper kinds are not checked here. */
const postAssets = { "qwen-cpu": ["qwen"], "qwen-gpu": ["qwen"], "qwen17-cpu": ["qwen-1.7b"], "qwen17-gpu": ["qwen-1.7b"] };

const phaseLabels = {
  idle: "準備就緒", starting: "正在啟動", running: "執行中", stopping: "正在停止",
  stopped: "已停止", complete: "已完成", error: "執行失敗",
};
const outputSuffixes = {
  "cpp-gpu": "cpp_gpu_transcript", "cpp-cpu": "cpp_cpu_transcript", "cpp-vulkan": "cpp_vulkan_transcript",
  "cpp-npu": "cpp_npu_transcript", "cpp-openvino-gpu": "cpp_openvino_gpu_transcript",
  "qwen-gpu": "qwen_gpu_transcript", "qwen-cpu": "qwen_cpu_transcript",
  "qwen17-gpu": "qwen17_gpu_transcript", "qwen17-cpu": "qwen17_cpu_transcript",
};
const MAX_LOG_CHUNKS = 600;
/** A session's transcript files, in the order they are listed. */
const transcriptFiles = [
  ["live", "live_transcript.txt", "Live"],
  ["cppCpu", "cpp_cpu_transcript.txt", "Whisper CPU"],
  ["cppGpu", "cpp_gpu_transcript.txt", "Whisper CUDA"],
  ["cppVulkan", "cpp_vulkan_transcript.txt", "Whisper Vulkan"],
  ["cppNpu", "cpp_npu_transcript.txt", "Whisper NPU"],
  ["cppOpenvinoGpu", "cpp_openvino_gpu_transcript.txt", "Whisper OpenVINO GPU"],
  ["qwenCpu", "qwen_cpu_transcript.txt", "Qwen CPU"],
  ["qwenGpu", "qwen_gpu_transcript.txt", "Qwen CUDA"],
  ["qwen17Cpu", "qwen17_cpu_transcript.txt", "Qwen 1.7B CPU"],
  ["qwen17Gpu", "qwen17_gpu_transcript.txt", "Qwen 1.7B CUDA"],
];

/* ───────────────────────── state ───────────────────────── */

const state = {
  locale: DEFAULT_LOCALE,
  theme: "system",
  tab: "live",
  version: "",
  settingsLoaded: false,
  saved: {},
  closing: false,
  // the one job
  phase: "idle",
  error: "",
  activeId: null,
  activeKind: "",
  activeLabel: "",
  stoppingId: null,
  launchPending: false,
  startedAt: null,
  endedAt: null,
  lastKind: "",
  // live
  liveModeId: "live-meeting",
  language: "auto",
  chineseScript: "as-is",
  saveWav: true,
  previewSeconds: 1,
  follow: true,
  transcriptPath: "",
  // capture
  systemDevice: "",
  micDevice: "",
  includeMic: false,
  devices: null,
  // record
  timedRecording: false,
  durationSeconds: 3600,
  // recordings
  outputDir: "outputs",
  sessions: [],
  selectedSessionId: "",
  audioPath: "",
  postKind: "cpp-cpu",
  qwen: { chunkSeconds: 60, tokens: 4096, batch: 16 },
  lastOutputPath: "",
  dragging: false,
  // models
  assets: [],
  assetsLoaded: false,
  downloads: {},
  // log
  logOpen: false,
};

const $ = (id) => document.getElementById(id);
const all = (selector, root = document) => [...root.querySelectorAll(selector)];
const t = (key, values) => translate(state.locale, key, values);

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? "" : value);
  }
  element.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}
const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
const setHidden = (element, hidden) => { if (element.hidden !== hidden) element.hidden = hidden; };
const setDisabled = (element, disabled) => { if (element.disabled !== disabled) element.disabled = disabled; };
const setChecked = (element, checked) => { if (element.checked !== checked) element.checked = checked; };
/** Inputs keep what the user is typing; render() only writes them when they are not focused. */
const setValue = (element, value) => { if (document.activeElement !== element && element.value !== String(value)) element.value = String(value); };

/** Rebuilds a select's options only when they change. */
function fillSelect(select, options, value) {
  const key = JSON.stringify(options);
  if (select.dataset.options !== key) {
    select.replaceChildren(...options.map(([optionValue, label]) => h("option", { value: optionValue, text: label })));
    select.dataset.options = key;
  }
  if (select.value !== value) select.value = value;
}

/* ───────────────────────── derived ───────────────────────── */

const liveMode = () => liveModes.find((mode) => mode.id === state.liveModeId) ?? liveModes[0];
const isRunning = () => state.activeId !== null || state.phase === "starting" || state.phase === "stopping";
const assetExists = (id) => state.assets.some((asset) => asset.id === id && asset.exists);
const liveUnavailable = () => !state.assetsLoaded || liveMode().assets.some((id) => !assetExists(id));
const postMissing = () => (postAssets[state.postKind] ?? []).filter((id) => !assetExists(id));
const postUnavailable = () => state.assetsLoaded && postMissing().length > 0;
const previewValid = () => Number.isFinite(state.previewSeconds) && state.previewSeconds >= 0.5 && state.previewSeconds <= 5;
const selectedSession = () => state.sessions.find((session) => session.id === state.selectedSessionId) ?? null;
const selectedAudioPath = () => selectedSession()?.audioPath || state.audioPath;
const outputDirSetting = () => state.outputDir.trim() || "outputs";
const basename = (path) => path.split(/[\\/]/).pop() || path;

function canStart(tab) {
  if (!state.settingsLoaded || isRunning()) return false;
  if (tab === "live") return !liveUnavailable() && previewValid();
  if (tab === "record") return !state.timedRecording || (Number.isFinite(state.durationSeconds) && state.durationSeconds > 0);
  if (tab === "recordings") return Boolean(selectedAudioPath()) && !postUnavailable();
  return false;
}

function captureSettings() {
  return { systemDevice: state.systemDevice.trim(), includeMic: state.includeMic, micDevice: state.micDevice.trim() };
}

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function formatWhen(time) {
  return new Date(time).toLocaleString(state.locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ───────────────────────── render ───────────────────────── */

const dirty = new Set(["all"]);
let frame = 0;
function invalidate(...keys) {
  for (const key of keys) dirty.add(key);
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}
const changed = (key) => dirty.has("all") || dirty.has(key);

function applyStaticText() {
  document.documentElement.lang = state.locale;
  for (const element of all("[data-i18n]")) setText(element, t(element.dataset.i18n));
  for (const element of all("[data-i18n-title]")) {
    element.title = t(element.dataset.i18nTitle);
    element.setAttribute("aria-label", element.title);
  }
}

function render() {
  if (changed("locale")) applyStaticText();
  renderChrome();
  renderLive();
  renderCapture($("page-live"), liveMode().capture);
  renderCapture($("page-record"), true);
  renderRecord();
  renderRecordings();
  renderSettings();
  dirty.clear();
}

function renderChrome() {
  for (const button of all("#tabs button")) button.setAttribute("aria-selected", String(button.dataset.tab === state.tab));
  for (const page of all("[data-page]")) setHidden(page, page.dataset.page !== state.tab);

  const chip = $("status-chip");
  chip.className = `status-chip ${state.phase}`;
  setText($("status-text"), t(phaseLabels[state.phase]));
  chip.title = state.activeLabel;
  setHidden($("status-clock"), state.startedAt === null);
  tickClock();

  const banner = $("banner");
  const message = state.closing ? t("Stopping jobs before closing…") : state.error ? translateError(state.locale, state.error) : "";
  setHidden(banner, !message);
  banner.classList.toggle("info", state.closing);
  setText($("banner-text"), message);
  $("banner-text").title = message;
  setHidden($("banner-close"), state.closing);

  $("log-toggle").setAttribute("aria-pressed", String(state.logOpen));
  setHidden($("log-drawer"), !state.logOpen);

  const hint = isRunning() ? `${t("目前工作：")}${state.activeLabel || t("正在準備")} ${t("· 啟動程序不代表已收到音訊")}` : "";
  for (const element of all(".job-hint")) {
    setText(element, hint);
    setHidden(element, !hint);
  }
}

/** The page's start button doubles as the stop button while a job runs. */
function renderAction(button, tab, startLabel) {
  const running = isRunning();
  button.classList.toggle("primary", !running);
  button.classList.toggle("stop", running);
  if (running) {
    setText(button, state.phase === "starting" ? t("正在啟動…") : state.phase === "stopping" ? t("正在停止…") : t("停止目前工作"));
    setDisabled(button, state.activeId === null || state.phase === "stopping");
  } else {
    setText(button, t(startLabel));
    setDisabled(button, !canStart(tab));
  }
}

function renderLive() {
  const mode = liveMode();
  const running = isRunning();
  renderAction($("live-start"), "live", "開始會議");

  const model = $("live-model");
  if (model.value !== mode.model) model.value = mode.model;
  setDisabled(model, running);
  fillSelect(
    $("live-backend"),
    liveModes.filter((item) => item.model === mode.model).map((item) => [item.id, t(item.label)]),
    mode.id,
  );
  setDisabled($("live-backend"), running);

  const wav = $("live-save-wav");
  setChecked(wav, mode.optionalWav ? state.saveWav : true);
  setDisabled(wav, running || !mode.optionalWav);
  setText($("live-wav-note"), t(mode.optionalWav ? "Keep the meeting audio for a later transcript" : "This backend always saves a WAV"));

  const preview = $("live-preview");
  setValue(preview, state.previewSeconds);
  setDisabled(preview, running || !mode.capture);
  preview.classList.toggle("invalid", !previewValid());
  setText($("live-preview-note"), t(mode.capture ? "字幕可修訂；停頓後定稿。錄音持續完整保存，停止會釋放模型。" : "Loopback 使用後端內建的 VAD 分段。"));

  const unavailable = liveUnavailable();
  setHidden($("live-assets-notice"), !unavailable);
  if (unavailable) {
    const missing = state.assets.filter((asset) => mode.assets.includes(asset.id) && !asset.exists).map((asset) => asset.label);
    setText(
      $("live-assets-text"),
      state.assetsLoaded ? `${t("缺少此組合的檔案")}${missing.length ? `: ${missing.join(", ")}` : ""}` : t("正在檢查本機模型…"),
    );
  }

  setText($("transcript-path"), state.transcriptPath || `${t("輸出資料夾：")}${outputDirSetting()}`);
  $("transcript-path").title = state.transcriptPath;
  setHidden($("open-transcript"), !state.transcriptPath);
  setChecked($("follow"), state.follow);
  const label = languages.find(([id]) => id === state.language)?.[1] ?? "自動偵測";
  setText($("caption-language"), `/ ${t(label)}`);
  const lang = captionLang();
  if ($("transcript").lang !== lang) $("transcript").lang = lang;
  for (const select of all("[data-language-select]")) {
    fillSelect(select, languages.map(([id, key]) => [id, t(key)]), state.language);
    setDisabled(select, isRunning());
  }
}

function deviceOptions(devices, selected, defaultName, fallbackKey) {
  const options = [["", `${defaultName || t(fallbackKey)}${t("（預設）")}`]];
  for (const device of devices) options.push([device.id || device.name, device.name]);
  if (selected && !devices.some((device) => (device.id || device.name) === selected)) options.push([selected, t("裝置未連接")]);
  return options;
}

function renderCapture(page, supported) {
  const running = isRunning();
  const devices = state.devices;
  const system = page.querySelector('[data-capture-select="system"]');
  fillSelect(
    system,
    supported ? deviceOptions(devices?.loopbacks ?? [], state.systemDevice, devices?.defaultSpeaker, "系統預設音源")
      : [["", `${devices?.defaultSpeaker || t("系統預設音源")}${t("（預設）")}`]],
    supported ? state.systemDevice : "",
  );
  setDisabled(system, running || !supported);
  const note = page.querySelector("[data-capture-note]");
  setText(note, supported ? "" : t("此後端只支援系統預設 loopback，不支援麥克風混音。"));
  setHidden(note, supported);

  const micToggle = page.querySelector("[data-capture-mic-toggle]");
  setChecked(micToggle, supported && state.includeMic);
  setDisabled(micToggle, running || !supported);
  page.querySelector('[data-capture="include-mic"]').classList.toggle("disabled", !supported);
  setHidden(page.querySelector('[data-capture="mic"]'), !(supported && state.includeMic));
  const mic = page.querySelector('[data-capture-select="mic"]');
  fillSelect(mic, deviceOptions(devices?.microphones ?? [], state.micDevice, devices?.defaultMicrophone, "預設麥克風"), state.micDevice);
  setDisabled(mic, running);
  for (const button of all("[data-refresh-devices]", page)) setDisabled(button, running);

  const error = page.querySelector("[data-capture-error]");
  setHidden(error, !devices?.error);
  if (devices?.error) setText(error, `${t("音訊裝置檢查失敗：")}${devices.error}`);
}

function renderRecord() {
  const running = isRunning();
  const recording = running && state.activeKind.startsWith("record-");
  renderAction($("record-start"), "record", "開始錄音");
  $("rec-indicator").classList.toggle("live", recording);
  setText($("record-title"), t(recording ? "音訊錄製程序已啟動" : "音訊錄製"));
  setChecked($("record-timed"), state.timedRecording);
  setDisabled($("record-timed"), running);
  setValue($("record-seconds"), state.durationSeconds);
  setDisabled($("record-seconds"), running || !state.timedRecording);
  setText($("record-output"), outputDirSetting());
}

function renderRecordings() {
  const running = isRunning();
  const session = selectedSession();
  if (changed("sessions") || changed("selection") || changed("locale")) {
    const list = $("session-list");
    list.replaceChildren(
      ...state.sessions.map((item) => {
        const t2 = item.transcripts;
        const tags = [
          t2.live && "Live",
          (t2.cppCpu || t2.cppGpu || t2.cppVulkan || t2.cppNpu || t2.cppOpenvinoGpu) && "Whisper",
          (t2.qwenCpu || t2.qwenGpu || t2.qwen17Cpu || t2.qwen17Gpu) && "Qwen",
        ].filter(Boolean);
        return h(
          "button",
          {
            class: "session",
            role: "option",
            "aria-selected": String(item.id === state.selectedSessionId),
            title: item.folderPath,
            onclick: () => { state.selectedSessionId = item.id; state.audioPath = ""; invalidate("selection"); },
          },
          h("span", { class: "glyph" }, waveIcon()),
          h("strong", { text: item.name }),
          h("span", { class: "meta" }, `${formatBytes(item.audioSize)} · ${formatWhen(item.modifiedTime)}`, ...tags.map((tag) => h("span", { class: "tag", text: tag }))),
        );
      }),
    );
    if (!state.sessions.length) list.append(h("div", { class: "empty-list", text: t("此資料夾尚無錄音。") }));
    setText($("session-count"), state.sessions.length ? String(state.sessions.length) : "");
  }

  const audio = selectedAudioPath();
  setText($("selected-name"), session?.name || (audio ? basename(audio) : t("No recording selected")));
  setText($("selected-path"), audio || t("選取錄音或匯入音訊檔案。"));
  $("selected-path").title = audio;
  setHidden($("open-session-folder"), !session);
  if (changed("sessions") || changed("selection")) {
    const files = session ? transcriptFiles.filter(([key]) => session.transcripts[key]) : [];
    $("transcript-files").replaceChildren(
      ...files.map(([, file, label]) => {
        const path = `${session.folderPath}\\${file}`;
        return h("button", { class: "btn", text: label, title: path, onclick: () => openPath(path) });
      }),
    );
    setHidden($("transcripts-row"), files.length === 0);
  }

  const qwen = state.postKind.startsWith("qwen");
  const model = postModelOf(state.postKind);
  const postModel = $("post-model");
  if (postModel.value !== model) postModel.value = model;
  setDisabled(postModel, running);
  fillSelect($("post-backend"), postBackends[model], state.postKind);
  const missing = postUnavailable() ? postMissing() : [];
  setHidden($("post-assets-notice"), missing.length === 0);
  if (missing.length) {
    const labels = missing.map((id) => state.assets.find((asset) => asset.id === id)?.label ?? id);
    setText($("post-assets-text"), `${t("缺少此組合的檔案")}: ${labels.join(", ")}`);
  }
  setDisabled($("post-backend"), running);
  for (const row of all("[data-qwen]")) setHidden(row, !qwen);
  setValue($("qwen-chunk"), state.qwen.chunkSeconds);
  setValue($("qwen-tokens"), state.qwen.tokens);
  setValue($("qwen-batch"), state.qwen.batch);

  renderAction($("transcribe-start"), "recordings", "開始轉錄");
  const showOutput = Boolean(state.lastOutputPath) && state.phase === "complete" && isPostKind(state.lastKind);
  setHidden($("open-output-file"), !showOutput);
  if (showOutput) {
    setText($("open-output-file"), `${t("開啟逐字稿：")}${state.lastOutputPath}`);
    $("open-output-file").title = state.lastOutputPath;
  }
  document.body.classList.toggle("dragging", state.dragging);
  setText($("dropzone-text"), t(state.dragging ? "Release to choose this file" : "Drop an audio file anywhere"));
}

function renderSettings() {
  const running = isRunning();
  for (const button of all("#theme-seg button")) button.setAttribute("aria-selected", String(button.dataset.themeValue === state.theme));
  for (const button of all("#locale-seg button")) button.setAttribute("aria-selected", String(button.dataset.locale === state.locale));
  for (const button of all("#script-seg button")) button.setAttribute("aria-selected", String(button.dataset.scriptValue === state.chineseScript));
  const output = $("output-dir");
  setValue(output, state.outputDir);
  setDisabled(output, running);
  setDisabled($("choose-output"), running);
  setDisabled($("reset-output"), running);
  setText($("about-version"), state.version ? t("Version {version}", { version: state.version }) : "");

  if (changed("assets") || changed("locale")) {
    $("asset-list").replaceChildren(
      ...state.assets.map((asset) => {
        const download = state.downloads[asset.id];
        const busy = download?.running === true;
        const status = busy ? "busy" : asset.exists ? "ok" : "missing";
        const canDownload = asset.downloadable && (busy || !asset.exists);
        return h(
          "div",
          { class: `row asset ${status}` },
          h(
            "div",
            { class: "row-main" },
            h("strong", { text: asset.label }),
            h("small", { class: "mono", text: asset.relativePath }),
            asset.note && !asset.exists ? h("small", { text: t(asset.note) }) : null,
            download && (busy || download.text === "Paused")
              ? h(
                  "div",
                  { class: "progress" },
                  h("span", {}, h("i", { style: `width: ${download.percent}%` })),
                  h("small", { text: `${download.percent}% · ${t(download.text)}` }),
                )
              : null,
          ),
          busy ? null : h("span", { class: "status" }, h("i"), t(asset.exists ? "Installed" : "Missing")),
          canDownload
            ? h("button", {
                class: "btn",
                text: t(busy ? "Pause" : "Download"),
                title: t(busy ? "暫停 {name}" : "下載 {name}", { name: asset.label }),
                onclick: () => void toggleDownload(asset.id),
              })
            : null,
        );
      }),
    );
  }
  setDisabled(
    $("download-missing"),
    !state.assets.some((asset) => asset.downloadable && !asset.optional && !asset.exists && !state.downloads[asset.id]?.running),
  );
}

/** Counts while the job runs and keeps its final time once it ends. */
function tickClock() {
  const until = state.endedAt ?? Date.now();
  const seconds = state.startedAt === null ? 0 : Math.max(0, Math.floor((until - state.startedAt) / 1000));
  const text = formatElapsed(seconds);
  setText($("status-clock"), text);
  setText($("rec-clock"), state.activeKind.startsWith("record-") && state.startedAt !== null ? text : "00:00");
}
setInterval(() => { if (state.startedAt !== null && state.endedAt === null) tickClock(); }, 1000);

function waveIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M2.5 8h1M5 5.5v5M7.5 3v10M10 5v6M12.5 7v2");
  svg.append(path);
  return svg;
}

/* ───────────────────────── captions & log ───────────────────────── */

const captionQueue = [];
const logQueue = [];
let streamFrame = 0;
function scheduleStreams() {
  if (!streamFrame) streamFrame = requestAnimationFrame(flushStreams);
}

function captionElement(line, fresh) {
  return h("div", { class: fresh ? "cap fresh" : "cap" }, h("time", { text: line.time }), h("p", { text: line.text }));
}

function flushStreams() {
  streamFrame = 0;
  if (captionQueue.length) {
    const lines = $("caption-lines");
    const partialElement = $("caption-partial");
    let partial;
    for (const update of captionQueue.splice(0)) {
      while (lines.children.length > update.from) lines.lastElementChild.remove();
      lines.append(...update.lines.map((line) => captionElement(line, true)));
      partial = update.partial;
    }
    setHidden(partialElement, !partial);
    if (partial) {
      setText(partialElement.querySelector("time"), partial.time);
      setText(partialElement.querySelector("p"), partial.text);
    }
    setHidden($("transcript-empty"), lines.children.length > 0 || Boolean(partial));
    if (state.follow) {
      const transcript = $("transcript");
      transcript.scrollTop = transcript.scrollHeight;
    }
  }
  if (logQueue.length) {
    const log = $("log");
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    $("log-empty")?.remove();
    log.append(...logQueue.splice(0).map(([stream, lines]) => h("span", { class: stream, text: `${lines.join("\n")}\n` })));
    while (log.children.length > MAX_LOG_CHUNKS) log.firstElementChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
  }
}

function clearCaptions() {
  captionQueue.length = 0;
  $("caption-lines").replaceChildren();
  setHidden($("caption-partial"), true);
  setHidden($("transcript-empty"), false);
}

function clearLog() {
  logQueue.length = 0;
  $("log").replaceChildren(h("span", { class: "muted", id: "log-empty", text: t("尚無程序訊息。") }));
}

function logLocal(stream, text) {
  const stamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  logQueue.push([stream, text.split(/\r?\n/).filter(Boolean).map((line) => `[${stamp}] ${line}`)]);
  scheduleStreams();
}

/* ───────────────────────── backend events ───────────────────────── */

function onProcessEvent(event) {
  if (event.type === "start") {
    if (state.activeId === event.processId) return;
    state.activeId = event.processId;
    state.activeKind = event.kind;
    state.activeLabel = event.label;
    state.phase = "running";
    state.startedAt = Date.now();
    state.endedAt = null;
    invalidate();
    return;
  }
  // Download output (process 0) always reaches the log; a stale job's never does.
  if (event.type === "log") {
    if (event.processId === 0 || event.processId === state.activeId) {
      logQueue.push([event.stream, event.lines]);
      scheduleStreams();
    }
    return;
  }
  if (event.processId !== state.activeId) return;
  if (event.type === "captions") {
    captionQueue.push(event);
    scheduleStreams();
    return;
  }
  if (event.type === "transcript-path") {
    state.transcriptPath = event.path;
    invalidate();
    return;
  }
  if (event.type === "exit") {
    const stopped = event.stopped || state.stoppingId === event.processId;
    state.activeId = null;
    state.stoppingId = null;
    state.endedAt = Date.now();
    state.lastKind = state.activeKind;
    state.activeKind = "";
    state.phase = stopped ? "stopped" : event.code === 0 ? "complete" : "error";
    if (!stopped && event.code !== 0) {
      state.error = event.lastError || `工作未完成（exit ${event.code ?? "null"}）。請查看詳細資訊。`;
    }
    void refreshSessions();
    invalidate();
  }
}

function onAssetEvent(event) {
  const current = state.downloads[event.assetId] ?? {};
  if (event.type === "start") {
    state.downloads[event.assetId] = { running: true, percent: 1, text: "Starting" };
  } else if (event.type === "progress") {
    state.downloads[event.assetId] = { ...current, running: current.running ?? true, percent: event.percent, text: event.text };
  } else if (event.type === "exit") {
    state.downloads[event.assetId] = {
      ...current,
      running: false,
      percent: event.code === 0 ? 100 : (current.percent ?? 0),
      text: event.code === 0 ? "Done" : "Paused",
      exitCode: event.code,
    };
    void refreshAssets();
  }
  invalidate("assets");
}

/* ───────────────────────── actions ───────────────────────── */

function setError(message) {
  state.error = message;
  invalidate();
}

let saveTimer = 0;
function persist() {
  if (!state.settingsLoaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const settings = {
      ...state.saved,
      outputDir: state.outputDir,
      capture: { systemDevice: state.systemDevice, micDevice: state.micDevice, includeMic: state.includeMic },
      live: { ...state.saved.live, mode: state.liveModeId, saveWav: state.saveWav, previewSeconds: state.previewSeconds },
      recognition: { language: state.language, chineseScript: state.chineseScript },
      post: { kind: state.postKind },
      qwen: { chunkSeconds: state.qwen.chunkSeconds, tokens: state.qwen.tokens, batch: state.qwen.batch },
      ui: { ...state.saved.ui, locale: state.locale, theme: state.theme },
    };
    state.saved = settings;
    invoke("save_settings", { settings }).catch((error) => setError(`設定未能儲存：${error}`));
  }, 250);
}

async function loadSettings() {
  let settings;
  try {
    settings = await invoke("load_settings");
  } catch (error) {
    setError(`無法載入設定：${error}`);
    return;
  }
  state.saved = settings;
  if (isLocale(settings.ui?.locale)) state.locale = settings.ui.locale;
  if (["system", "light", "dark"].includes(settings.ui?.theme)) state.theme = settings.ui.theme;
  if (isPostKind(settings.post?.kind)) state.postKind = settings.post.kind;
  else if (settings.live?.mode === "live-cpp-gpu") state.postKind = "cpp-gpu";
  if (settings.capture) {
    state.systemDevice = settings.capture.systemDevice || "";
    state.micDevice = settings.capture.micDevice || "";
    state.includeMic = settings.capture.includeMic === true;
  }
  if (liveModes.some((mode) => mode.id === settings.live?.mode)) state.liveModeId = settings.live.mode;
  if (typeof settings.live?.saveWav === "boolean") state.saveWav = settings.live.saveWav;
  if (isLanguage(settings.recognition?.language)) state.language = settings.recognition.language;
  if (chineseScripts.includes(settings.recognition?.chineseScript)) state.chineseScript = settings.recognition.chineseScript;
  const preview = settings.live?.previewSeconds;
  if (typeof preview === "number" && preview >= 0.5 && preview <= 5) state.previewSeconds = preview;
  if (settings.outputDir) state.outputDir = settings.outputDir;
  for (const [key, field] of [["chunkSeconds", "chunkSeconds"], ["tokens", "tokens"], ["batch", "batch"]]) {
    if (typeof settings.qwen?.[key] === "number") state.qwen[field] = settings.qwen[key];
  }
  state.settingsLoaded = true;
  applyTheme();
  invalidate("locale");
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  try {
    localStorage.setItem("theme", state.theme);
    localStorage.setItem("locale", state.locale);
  } catch {}
}

async function refreshAssets() {
  try {
    state.assets = await invoke("check_assets");
    state.assetsLoaded = true;
  } catch (error) {
    setError(`無法檢查本機模型：${error}`);
  }
  invalidate("assets");
}

async function refreshAudioDevices() {
  try {
    state.devices = await invoke("list_audio_devices");
  } catch (error) {
    state.devices = { defaultSpeaker: "", defaultMicrophone: "", loopbacks: [], microphones: [], error: String(error) };
  }
  invalidate("devices");
}

let sessionsRequest = 0;
async function refreshSessions() {
  const request = ++sessionsRequest;
  let found;
  try {
    found = await invoke("list_output_sessions", { outputDir: outputDirSetting() });
  } catch (error) {
    setError(`無法讀取錄音列表：${error}`);
    return;
  }
  if (request !== sessionsRequest) return;
  state.sessions = found;
  if (!(state.selectedSessionId && found.some((session) => session.id === state.selectedSessionId)) && !state.audioPath) {
    state.selectedSessionId = found[0]?.id || "";
  }
  invalidate("sessions");
}

function expectOutput(kind) {
  const suffix = outputSuffixes[kind];
  const audio = selectedAudioPath();
  if (!suffix || !audio) return;
  if (basename(audio).toLowerCase() === "audio.wav") {
    state.lastOutputPath = `${audio.replace(/[\\/]audio\.wav$/i, "")}\\${suffix}.txt`;
    return;
  }
  const source = basename(audio).replace(/\.[^.\\/]+$/, "") || "audio";
  state.lastOutputPath = `${outputDirSetting().replace(/[\\/]$/, "")}\\${source}_${suffix}.txt`;
}

async function run(kind, args = {}) {
  if (state.launchPending || state.activeId !== null) return;
  state.launchPending = true;
  state.phase = "starting";
  state.error = "";
  state.startedAt = null;
  state.endedAt = null;
  expectOutput(kind);
  if (kind.startsWith("live-")) {
    state.transcriptPath = "";
    clearCaptions();
  }
  invalidate();
  try {
    const started = await invoke("run_command", { kind, args: { outputDir: outputDirSetting(), ...args } });
    // Events and replies travel separately; adopt the job if its start event is late.
    if (state.activeId === null && state.phase === "starting") {
      state.activeId = started.processId;
      state.activeKind = kind;
      state.activeLabel = started.label;
      state.phase = "running";
      state.startedAt = Date.now();
      state.endedAt = null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.phase = "error";
    state.error = message;
    logLocal("stderr", message);
  } finally {
    state.launchPending = false;
    invalidate();
  }
}

async function stop() {
  const processId = state.activeId;
  if (processId === null || state.stoppingId === processId) return;
  state.stoppingId = processId;
  state.phase = "stopping";
  state.error = "";
  invalidate();
  try {
    const result = await invoke("stop_command", { processId });
    if (!result.stopped && state.activeId === processId) throw new Error("無法確認工作狀態，請查看詳細資訊。");
    // The exit event owns completion; do not announce success before it arrives.
  } catch (error) {
    state.stoppingId = null;
    if (state.activeId !== processId) return;
    state.phase = "running";
    setError(`停止失敗：${error instanceof Error ? error.message : error}`);
  }
}

function startOrStop(tab) {
  if (isRunning()) return void stop();
  if (!canStart(tab)) return;
  if (tab === "live") {
    const mode = liveMode();
    // faster-whisper has a separate no-WAV launch; SenseVoice takes saveWav.
    const kind = mode.id === "live-meeting" && !state.saveWav ? "live-whisper" : mode.id;
    void run(kind, {
      previewSeconds: state.previewSeconds,
      saveWav: mode.optionalWav ? state.saveWav : true,
      language: state.language,
      chineseScript: state.chineseScript,
      ...(mode.capture ? captureSettings() : { systemDevice: "", includeMic: false, micDevice: "" }),
    });
  } else if (tab === "record") {
    void run(state.timedRecording ? "record-timed" : "record-enter", { durationSeconds: state.durationSeconds, ...captureSettings() });
  } else if (tab === "recordings") {
    const audioPath = selectedAudioPath();
    void run(
      state.postKind,
      state.postKind.startsWith("qwen")
        ? { audioPath, language: state.language, chunkSeconds: state.qwen.chunkSeconds, qwenTokens: state.qwen.tokens, qwenBatch: state.qwen.batch }
        : { audioPath, language: state.language },
    );
  }
}

async function pickAudio() {
  const file = await invoke("pick_audio_file", { title: t("Select audio file"), filterName: t("Audio") }).catch((error) => {
    setError(String(error));
    return null;
  });
  if (file) chooseExternalAudio(file);
}

function chooseExternalAudio(path) {
  state.audioPath = path;
  state.selectedSessionId = "";
  state.tab = "recordings";
  invalidate("selection");
}

async function pickOutputFolder() {
  const folder = await invoke("pick_output_folder", { title: t("Select output folder") }).catch(() => null);
  if (folder) setOutputDir(folder);
}

let sessionsTimer = 0;
function setOutputDir(value) {
  state.outputDir = value;
  persist();
  clearTimeout(sessionsTimer);
  sessionsTimer = setTimeout(() => void refreshSessions(), 300);
  invalidate();
}

const openPath = (target) => invoke("open_path", { target }).catch((error) => setError(String(error)));

async function toggleDownload(assetId) {
  const asset = state.assets.find((item) => item.id === assetId);
  if (!asset?.downloadable) return;
  try {
    if (state.downloads[assetId]?.running) await invoke("stop_asset_download", { assetId });
    else await invoke("start_asset_download", { assetId });
  } catch (error) {
    setError(String(error));
  }
}

async function downloadMissing() {
  for (const asset of state.assets) {
    // Optional models (Qwen 1.7B, 4.4 GB) are downloaded from their own row.
    if (asset.downloadable && !asset.optional && !asset.exists && !state.downloads[asset.id]?.running) {
      await invoke("start_asset_download", { assetId: asset.id }).catch((error) => setError(String(error)));
    }
  }
}

function setTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  invalidate();
}

function setLogOpen(open) {
  state.logOpen = open;
  invalidate();
  if (open) requestAnimationFrame(() => { const log = $("log"); log.scrollTop = log.scrollHeight; });
}

/* ───────────────────────── wiring ───────────────────────── */

function bind() {
  for (const button of all("#tabs button")) button.addEventListener("click", () => setTab(button.dataset.tab));

  $("win-min").addEventListener("click", () => void appWindow.minimize());
  $("win-max").addEventListener("click", () => void appWindow.toggleMaximize());
  $("win-close").addEventListener("click", () => void appWindow.close());
  $("log-toggle").addEventListener("click", () => setLogOpen(!state.logOpen));
  $("close-log").addEventListener("click", () => setLogOpen(false));
  $("clear-log").addEventListener("click", clearLog);
  $("banner-log").addEventListener("click", () => setLogOpen(true));
  $("banner-close").addEventListener("click", () => setError(""));

  // Live
  $("live-start").addEventListener("click", () => startOrStop("live"));
  $("live-model").addEventListener("change", (event) => {
    state.liveModeId = liveModes.find((mode) => mode.model === event.target.value).id;
    persist();
    invalidate();
  });
  $("live-backend").addEventListener("change", (event) => { state.liveModeId = event.target.value; persist(); invalidate(); });
  $("live-save-wav").addEventListener("change", (event) => { state.saveWav = event.target.checked; persist(); invalidate(); });
  $("live-preview").addEventListener("input", (event) => {
    state.previewSeconds = Number(event.target.value);
    if (previewValid()) persist();
    invalidate();
  });
  $("live-manage-assets").addEventListener("click", () => setTab("settings"));
  $("post-manage-assets").addEventListener("click", () => setTab("settings"));
  $("open-transcript").addEventListener("click", () => openPath(state.transcriptPath));
  $("follow").addEventListener("change", (event) => {
    state.follow = event.target.checked;
    if (state.follow) $("transcript").scrollTop = $("transcript").scrollHeight;
  });
  $("transcript").addEventListener("scroll", (event) => {
    const element = event.currentTarget;
    if (state.follow && element.scrollHeight - element.scrollTop - element.clientHeight > 48) {
      state.follow = false;
      invalidate();
    }
  }, { passive: true });

  // Capture rows, shared by Live and Record
  for (const select of all('[data-capture-select="system"]')) {
    select.addEventListener("change", (event) => { state.systemDevice = event.target.value; persist(); invalidate(); });
  }
  for (const select of all('[data-capture-select="mic"]')) {
    select.addEventListener("change", (event) => { state.micDevice = event.target.value; persist(); invalidate(); });
  }
  for (const toggle of all("[data-capture-mic-toggle]")) {
    toggle.addEventListener("change", (event) => { state.includeMic = event.target.checked; persist(); invalidate(); });
  }
  for (const button of all("[data-refresh-devices]")) button.addEventListener("click", () => void refreshAudioDevices());

  // Record
  $("record-start").addEventListener("click", () => startOrStop("record"));
  $("record-timed").addEventListener("change", (event) => { state.timedRecording = event.target.checked; invalidate(); });
  $("record-seconds").addEventListener("input", (event) => { state.durationSeconds = Number(event.target.value); invalidate(); });
  for (const button of all("[data-open-output]")) button.addEventListener("click", () => openPath(outputDirSetting()));

  // Recordings
  $("transcribe-start").addEventListener("click", () => startOrStop("recordings"));
  $("refresh-sessions").addEventListener("click", () => void refreshSessions());
  $("pick-audio").addEventListener("click", () => void pickAudio());
  $("open-session-folder").addEventListener("click", () => { const session = selectedSession(); if (session) openPath(session.folderPath); });
  $("open-output-file").addEventListener("click", () => openPath(state.lastOutputPath));
  $("post-model").addEventListener("change", (event) => { state.postKind = switchPostModel(state.postKind, event.target.value); persist(); invalidate(); });
  $("post-backend").addEventListener("change", (event) => { state.postKind = event.target.value; persist(); invalidate(); });
  for (const [id, field] of [["qwen-chunk", "chunkSeconds"], ["qwen-tokens", "tokens"], ["qwen-batch", "batch"]]) {
    $(id).addEventListener("input", (event) => { state.qwen[field] = Number(event.target.value); persist(); });
  }

  // Settings
  for (const select of all("[data-language-select]")) {
    select.addEventListener("change", (event) => { state.language = event.target.value; persist(); invalidate(); });
  }
  for (const button of all("#script-seg button")) {
    button.addEventListener("click", () => { state.chineseScript = button.dataset.scriptValue; persist(); invalidate(); });
  }
  for (const button of all("#theme-seg button")) {
    button.addEventListener("click", () => { state.theme = button.dataset.themeValue; applyTheme(); persist(); invalidate(); });
  }
  $("locale-seg").replaceChildren(
    ...locales.map((locale) =>
      h("button", {
        "data-locale": locale,
        lang: locale,
        text: localeNames[locale],
        onclick: () => { state.locale = locale; applyTheme(); persist(); invalidate("locale"); },
      }),
    ),
  );
  $("output-dir").addEventListener("input", (event) => setOutputDir(event.target.value));
  $("choose-output").addEventListener("click", () => void pickOutputFolder());
  $("reset-output").addEventListener("click", () => setOutputDir("outputs"));
  $("open-github").addEventListener("click", () => openPath("https://github.com/kuchris/local-meeting-stt"));
  $("refresh-assets").addEventListener("click", () => void refreshAssets());
  $("download-missing").addEventListener("click", () => void downloadMissing());

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey && key === "o") { event.preventDefault(); void pickAudio(); }
    else if (event.ctrlKey && key === "l") { event.preventDefault(); setLogOpen(!state.logOpen); }
    else if (event.ctrlKey && ["1", "2", "3", "4"].includes(key)) { event.preventDefault(); setTab(["live", "record", "recordings", "settings"][Number(key) - 1]); }
    else if (key === "escape" && state.logOpen) setLogOpen(false);
    // A reload would drop the running job's captions; the job itself keeps going.
    else if (key === "f5" || (event.ctrlKey && key === "r")) event.preventDefault();
  });
  document.addEventListener("contextmenu", (event) => {
    const editable = event.target.closest("input, textarea");
    if (!editable && !String(window.getSelection())) event.preventDefault();
  });

  tauri.webview.getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter" || payload.type === "over") {
      if (!state.dragging) { state.dragging = true; invalidate(); }
    } else if (payload.type === "leave") {
      state.dragging = false;
      invalidate();
    } else if (payload.type === "drop") {
      state.dragging = false;
      if (payload.paths?.[0]) chooseExternalAudio(payload.paths[0]);
      else setError("無法讀取拖放檔案，請使用選取音訊。");
      invalidate();
    }
  });

  const maxIcon = $("win-max").querySelector("svg");
  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized().catch(() => false);
    maxIcon.innerHTML = maximized
      ? '<rect x="2.5" y=".5" width="7" height="7"/><path d="M.5 2.5v7h7"/>'
      : '<rect x=".5" y=".5" width="9" height="9"/>';
  };
  void appWindow.onResized(() => void syncMaximized());
  void syncMaximized();
}

async function init() {
  bind();
  await Promise.all([
    tauri.event.listen("process-event", ({ payload }) => onProcessEvent(payload)),
    tauri.event.listen("asset-download-event", ({ payload }) => onAssetEvent(payload)),
    tauri.event.listen("app-closing", () => { state.closing = true; invalidate(); }),
  ]);
  invoke("app_info").then((info) => { state.version = info.version; invalidate(); }).catch(() => {});
  await loadSettings();
  render();
  requestAnimationFrame(() => void invoke("app_ready"));
  void refreshAssets();
  void refreshAudioDevices();
  void refreshSessions();
}

void init();
