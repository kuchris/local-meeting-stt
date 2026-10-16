# Local Meeting STT — Rust desktop app

A Rust ([Tauri 2](https://tauri.app/)) shell for the Python and whisper.cpp
backends. It replaced the Electron app, which is kept on the `electron` branch. The window is the system's WebView2, not a
bundled Chromium, and the interface is plain HTML, CSS and JavaScript with no
framework or npm step.

```text
desktop/
  src-tauri/             Rust: window, process control, captions, devices
    src/main.rs          commands the page calls, window and quit handling
    src/jobs.rs          starts, reads and stops backend processes
    src/commands.rs      what each job runs (same table as the Electron main process)
    src/captions.rs      turns live stdout into caption lines
    src/devices.rs       audio endpoints straight from WASAPI
    src/assets.rs        local model and runtime checks
    src/sessions.rs      recording folders in the output folder
    src/settings.rs      settings.json, also readable by the Electron app
    src/wav.rs           WAV header repair after an interrupted recording
    fixtures/            caption_parity.json, see Tests
  ui/                    the page: index.html, app.css, app.js, i18n.js
```

## Run

Requirements: Windows 10/11 with the WebView2 runtime (built into Windows 11),
[Rust](https://rustup.rs/) with the MSVC toolchain, and
[uv](https://docs.astral.sh/uv/) for the Python backends.

```powershell
cd desktop\src-tauri
cargo run
```

Or run `open_desktop_app.cmd` in the repository root: it opens a release build
when there is one and otherwise builds and runs the debug app. The UI files are
embedded at build time, so rebuild after changing `ui/`.

The app finds the backends by walking up from its executable to the folder that
holds `python_backend/record_audio.py`, and keeps `settings.json`, `models/`,
`outputs/` and `runtime/` there too. `LOCAL_MEETING_STT_ROOT` and
`LOCAL_MEETING_STT_DATA_ROOT` override either folder.

## What changed from the Electron app

The pages, backends, launch arguments, stop behaviour and `settings.json`
format are the same. Differences:

- **Audio devices** are read from WASAPI in about 10 ms. The Electron app
  started `uv` and Python for every refresh (about 0.5 s warm, several seconds
  cold). The ids are the endpoint ids `soundcard` reports, so `--system-device`
  and `--mic-device` match exactly. Python remains the fallback.
- **Captions** are merged in Rust (`captions.rs`, a port of the renderer's
  logic). The page receives "replace from line N" updates and appends them, so
  a caption no longer re-renders the whole window. The log keeps the last 600
  chunks and updates at most once per frame.
- **Qwen jobs start about 4 s sooner**: `uv run --offline` uses the cached,
  pinned environment without rechecking the package indexes, and a job whose
  cache is missing is rerun online (`commands::failed_offline` tells uv's
  offline errors from the script's). `post_transcribe_qwen.py` also defers
  `nagisa`, a tokenizer qwen-asr imports only for forced alignment.
- **Four recognition languages**: Chinese (Mandarin), Cantonese, English and
  Japanese, or Auto-detect, chosen on Live and Recordings and passed to every
  backend except Vulkan. Live Chinese captions are converted to Traditional (HK),
  or Simplified if chosen in Settings, in the live scripts
  (`python_backend/text_script.py`), so the saved transcript matches the screen;
  a Japanese session is never converted. Caption filters cover Chinese and English
  sign-offs Whisper invents, as well as Japanese ones.
- **SenseVoice-Small live captions** through sherpa-onnx: int8 on CPU
  (`live_sensevoice.cmd`) or fp32 on CUDA (`live_sensevoice_gpu.cmd`, with
  NVIDIA's CUDA 12 / cuDNN 9 pip packages). `test/sensevoice_replay.py` runs the
  whole live path on a public Cantonese clip without opening an audio device.
- **Two live models**: Whisper large-v3-turbo (CUDA) and SenseVoice-Small (CPU
  or CUDA). The Whisper small/base live modes (faster-whisper, whisper.cpp CPU,
  CUDA, Vulkan, OpenVINO and the Vulkan loopback stream) were removed; a saved
  one opens as SenseVoice-Small on CPU. Their scripts remain for command-line use.
- **Drop an audio file anywhere** in the window; it opens Recordings with that file.
- **Light, dark or system** theme, set in Settings.
- The File/Run/View menu bar and the resizable recordings column are gone.
  Shortcuts: `Ctrl+O` open audio, `Ctrl+1`–`4` pages, `Ctrl+L` log, `Esc` close log.
- A recording's existing transcripts are listed on Recordings and open in one click.

## Tests

```powershell
cd desktop\src-tauri
cargo test
cargo clippy --all-targets
```

`captions::tests::matches_the_electron_renderer` replays the steps in
`fixtures/caption_parity.json` and compares the lines with the `expected`
output, which was produced by running the Electron renderer's own caption
functions (`electron_app/src/main.tsx` on the `electron` branch) on the same
steps. When the caption rules change on purpose, update the fixture from the
Rust output and review the diff.

`devices::machine::print_native_listing` is ignored by default; run it with
`cargo test -- --ignored --nocapture` to compare this machine's endpoints with
`uv run --with soundcard ... python_backend/record_audio.py --list-devices`.

## Portable folder

```powershell
build_portable_folder.cmd
```

This builds the release executable and writes
`desktop/dist/release-VERSION-ID/` with the portable folder, a versioned ZIP
and `SHA256SUMS.txt`, packed the same way as the Electron build: executable,
backend scripts, fresh English settings and the local Vulkan/OpenVINO
runtimes, without models, Python environments, caches or recordings.
