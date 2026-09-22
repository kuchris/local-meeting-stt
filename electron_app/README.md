# Electron meeting interface

The meeting page keeps the session action visible above the transcript. The same
Stop action remains available on Record, Transcribe and Setup while a job runs.
Model, audio source and microphone settings are locked during launch/run/stop;
diagnostic logs and backend options are under Details.

English is the default for new installations and settings without a valid locale.
The title-bar language selector offers English, Traditional Chinese and Japanese;
existing saved language choices are preserved.
The selection is saved in `settings.json` as `ui.locale`. Changing display language
does not change the Japanese recognition language or alter transcript content;
model names, paths, device names and raw backend logs retain their original text.
App-defined file-dialog titles follow the selected language; OS dialog controls
follow Windows language settings.

Post-transcription remembers the selected model/backend as `post.kind`. Switching
between Whisper and Qwen retains CPU/CUDA selection. Existing saved post settings
take priority; when no post preference exists, a saved CUDA live configuration
initializes the post backend to CUDA. Other configurations retain the CPU default.

The app calls the existing Python, `.cmd`, `.bat`, and whisper.cpp workflows
from the parent repo and streams their output into the UI.

## Run and package

Double-click `open_electron_app.cmd` from the repository root. It opens
`electron_app/dist/win-unpacked/Local Meeting STT.exe` when available; otherwise
it starts development mode. To run development mode manually:

```powershell
cd electron_app
npm install
npm run dev
```

Use `npm run dist` to create `dist/win-unpacked/`, or `npm run dist:portable`
to try a single portable executable. For the repository's folder-style portable
package, run `build_portable_folder.cmd` from the repository root. It creates
`electron_app/dist/Local Meeting STT portable/` with the executable, backend
scripts, settings, output/model folders and runtime.

The `dev` and `preview` scripts clear `ELECTRON_RUN_AS_NODE` first, because that
variable can make Electron start as plain Node and leave a blank app window.

## Pages and controls

- Live meeting: model, audio source, optional microphone, transcript and diagnostics.
- Record audio: timed recording or recording until Stop.
- Recordings & transcripts: choose/drop audio and select a model and transcription backend.
- Settings & models: check/download assets and configure the output folder.
- `Ctrl+B`: toggle the sidebar; `Ctrl+O`: choose audio for transcription.
- Clear Logs clears diagnostic output while preserving the live transcript.

Blank audio-device selection uses the script default. Supported commands receive
`--system-device`, `--include-mic` and `--mic-device` for explicit selections.

## Models and backends

`src/liveModes.ts` maps the controls to the existing commands. Defaults remain
Whisper small with the existing faster-whisper launch path. No Nemotron/Turbo
migration or automatic model download is part of this change.

- Small offers the existing faster-whisper, CPU, CUDA, Vulkan, OpenVINO and
  Vulkan loopback paths. Base uses the existing Vulkan loopback base command.
- Vulkan loopback uses the system default audio source and cannot mix the mic.
  The UI disables those unsupported controls instead of silently ignoring them.
- Only faster-whisper has a live text-only option. Other existing live commands
  always record WAV, which the controls explicitly reflect.
- Asset checks detect missing paths; they do not establish hardware support or
  verify complete model downloads.

Launch, running, stopping, stopped, completed and failed states are distinct.
Running means the child process has started, not that the model or audio device
is ready. Stop waits for the child exit event. Python capture backends receive a
stop-file signal and get up to 10 seconds to close the WAV and release their model
worker before a forced process-tree termination. File transcription and native
loopback commands are terminated directly. Stopped does not promise a complete
transcript: queued and partial captions may be omitted. Closing Electron also
waits for backend cleanup.

CUDA and CPU live Whisper commands now keep whisper-server resident for the
meeting, rather than loading the small model for every audio chunk. Models are
released at session end, not cached between meetings. The faster-whisper queue
holds at most one waiting chunk; overload drops old caption chunks while the
recording continues. Details lets users lower the 3-second chunk setting to 2
seconds, with a possible loss of sentence context.

Qwen CPU/GPU and the batch-file launchers share `python_backend/qwen-requirements.txt`
(qwen-asr 0.0.6, PyTorch 2.11/CUDA 12.8). CPU uses the same installed runtime with
`--device cpu`. Local model files are required; inference does not fetch a remote
model. The runtime performs a small CUDA kernel check before loading GPU weights.

## Build and checks

From this directory:

```powershell
npm ci
npm run build
```

From the repository root, with Python/uv and Chromium available:

```powershell
uv run --no-project --with playwright --python 3.11 python -m playwright install chromium
uv run --no-project --with playwright --python 3.11 python electron_app/tests/ui_smoke.py
```

The test serves the built renderer on an ephemeral loopback port and uses mock
IPC. It covers input labels/persistence, default model and command selection,
unsupported controls, missing assets, asynchronous launch/stop, error recovery,
stale events, Ctrl+O, post-transcription, and Stop visibility across all four pages
at 1280×740 and 1180×660. Screenshots are saved under
`outputs/ui-review/implemented/`. It neither captures audio nor runs recognition.

Native Electron preload/IPC and the file-backed drag/drop bridge were also
smoke-tested locally using isolated settings. Actual microphone/system-audio
capture, recognition quality and recording finalization need separate live tests.

Backend tests, from the repository root:

```powershell
uv run python -m unittest discover -s python_backend/tests -v
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests python -m unittest discover -s test -p test_backend_lifecycle.py -v
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with psutil python test/backend_replay.py
node electron_app/tests/backend_smoke.cjs
node electron_app/tests/native_ui_smoke.cjs
```

The replay test requires the existing public benchmark sample and CUDA small
model; it feeds a simulated device into the real capture/server pipeline and
checks WAV finalization and child-process release. The native test needs a local
Playwright Node module (`PLAYWRIGHT_MODULE` may point to it), local Qwen weights,
and the same public sample. It exercises real Electron Qwen GPU transcription,
Stop, and window-close cleanup using isolated settings. Neither test records
microphones or system audio. Real WASAPI device behavior remains a separate check.
The native UI test checks persisted language/backend choices and localized dialog
titles without loading a recognition model. Renderer tests cover all four pages
in three languages, narrow-window controls, live language switching and settings
migration.

## Backend paths

Backend scripts resolve from the code root and local data from the data root.
Both usually point to the repository root in development. In folder-portable
mode, the data root is the folder beside the executable when it contains
`settings.json`. Electron user data is under `runtime/electron-user-data/`;
uv cache/environment paths also stay under `runtime/`.

The CPP Server modes keep `whisper-server.exe` running for the session and post
captured audio chunks to it, avoiding a model reload for each chunk.
See [TECHNICAL.md](../TECHNICAL.md) for backend commands and asset details.
