# Technical Notes

This file documents the backend scripts and local asset layout behind the Electron app.

## Folder Layout

```text
electron_app/       Electron + React + Vite desktop app
python_backend/    Python scripts and Windows .cmd wrappers
whisper_cpp/       whisper.cpp runtimes, models, wrappers, and output
test/              demo audio, demo transcripts, and drag/drop test .bat files
recordings/        generated meeting recordings
outputs/           Electron app output folder for recordings and transcripts
models/            faster-whisper and Qwen model folders
runtime/           portable/local runtime data, uv cache, venv, and Electron user data
settings.json      portable/local UI and output settings
```

Ignored local folders include `models/`, `outputs/`, `recordings/`, `runtime/`, `whisper_cpp/bin_*`, `whisper_cpp/models/`, `whisper_cpp/output/`, `electron_app/node_modules/`, `electron_app/out/`, and Electron build output folders.

## Backend Scripts

```text
python_backend/record_audio.py          records Windows system loopback audio
python_backend/live_transcribe.py       records chunks and writes a live faster-whisper transcript
python_backend/transcribe_audio.py      batch transcribes an existing audio file with faster-whisper
python_backend/post_transcribe_qwen.py  post-processes a recording with Qwen3-ASR
python_backend/download_assets.py       downloads ignored local models and whisper.cpp runtime files
python_backend/whisper_models.py        resolves local faster-whisper model paths
```

The `.cmd` wrappers run these scripts through `uv` with temporary dependencies.

## Main Commands

Start the Electron app:

```powershell
cd electron_app
npm install
npm run dev
```

Live meeting mode:

```powershell
python_backend\live_meeting.cmd
```

Lower live delay:

```powershell
python_backend\live_meeting.cmd --chunk-seconds 3
```

Audio-only recording:

```powershell
python_backend\record_meeting.cmd --until-enter
```

Batch transcription with faster-whisper:

```powershell
uv run --with faster-whisper python python_backend\transcribe_audio.py audio.wav --model small
```

Post-meeting Qwen3-ASR transcript:

```powershell
python_backend\post_transcribe_qwen.cmd recordings\meeting.wav
```

List Windows capture devices:

```powershell
uv run --with soundcard --with soundfile --with numpy --with soxr python python_backend\record_audio.py --list-devices
```

## Test Drag/Drop Wrappers

These are kept under `test/` with the demo audio.

```text
drop a .wav file onto test\drop_qwen_gpu.bat
drop a .wav file onto test\drop_qwen_cpu.bat
drop a .wav file onto test\drop_cpp_gpu.bat
drop a .wav file onto test\drop_cpp_cpu.bat
```

The wrappers `cd` back to the repo root before running backend commands, so they still work from inside `test/`.

## Local Assets

Download all local assets:

```powershell
uv run --with huggingface-hub python python_backend\download_assets.py
```

Download assets into a portable folder:

```powershell
uv run --with huggingface-hub python python_backend\download_assets.py --target-root "path\to\Local Meeting STT portable"
```

Download only whisper.cpp assets:

```powershell
uv run --with huggingface-hub python python_backend\download_assets.py --skip-faster-whisper --skip-qwen
```

Expected model folders:

```text
models/
  faster-whisper-small/
  Qwen3-ASR-0.6B/
```

Expected whisper.cpp folders:

```text
whisper_cpp/
  bin_cpu/
  bin_cuda/
  bin_vulkan/
  bin_vulkan_loopback/
  models/
```

Do not commit model files or downloaded runtimes to normal Git history. Use releases, external storage, or Git LFS if distribution is needed later.

`bin_cpu/`, `bin_cuda/`, and the ggml models can be downloaded by the asset downloader.
`bin_vulkan/` and `bin_vulkan_loopback/` are local build artifacts. The Setup tab
checks whether they exist, but it does not download them. Build or copy them locally
before using `CPP Vulkan`, `CPP Vulkan LB Base`, or `CPP Vulkan LB Small`.

The Electron Setup tab uses the same downloader. Per-asset downloads are launched independently and report `ASSET_PROGRESS` lines for row progress. whisper.cpp zip/model downloads use resumable `.part` files where possible. Hugging Face snapshot model folders may still report stage-style progress.

## whisper.cpp

`whisper.cpp` work lives in:

```text
whisper_cpp/
```

Useful commands:

```powershell
cd whisper_cpp
live_cpp.cmd
live_cpp_cpu.cmd
live_cpp_server_cpu.cmd
stream_cpp.cmd
transcribe_cpp.cmd ..\test\demo.wav output\demo
```

This folder is for comparing whisper.cpp latency and CPU/GPU behavior against the Python faster-whisper workflow.

`live_cpp_cpu.cmd` uses the same SoundCard loopback capture as the Python live workflow, but it calls `whisper-cli.exe` once per chunk. The thread count is auto-selected from the local CPU unless `--threads` is passed.

`live_cpp_server_cpu.cmd` is the preferred whisper.cpp CPU live path. It uses the same SoundCard loopback capture, starts `whisper-server.exe` as a child process, posts each chunk to `/inference`, and appends the returned text to `live_transcript.txt`. This keeps the model resident without losing the app's Windows speaker loopback selection.

`stream_cpp.cmd` is only a standalone experiment. It uses `whisper-stream.exe`, which keeps the model resident but uses SDL capture devices instead of the app's Windows loopback selector. If SDL only lists a microphone, this path will not capture Teams/browser speaker audio.

No-sound whisper.cpp CPU file test:

```powershell
whisper_cpp\bin_cpu\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f test\audio.wav -l ja -otxt -of test\audio_cpp_cpu_sim -t 6 -ng
```

## Electron Build Check

```powershell
cd electron_app
npm run build
```

## Portable Folder Build

Create a folder-style portable package:

```powershell
build_portable_folder.cmd
```

This writes:

```text
electron_app/dist/Local Meeting STT portable/
  Local Meeting STT.exe
  settings.json
  README.txt
  python_backend/
  whisper_cpp/
  models/
  outputs/
  runtime/
```

The portable folder copies backend scripts but does not bundle model files or Python packages. Models can be downloaded from the Setup tab into the portable folder. `runtime/uv-cache`, `runtime/venv`, and `runtime/electron-user-data` are local machine state.

The Electron main process uses two roots:

- code root: folder containing `python_backend/record_audio.py`
- data root: folder beside the portable exe when it contains `settings.json`; otherwise the repo root

Relative output/model/settings paths resolve against the data root.
