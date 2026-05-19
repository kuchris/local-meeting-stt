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

Ignored local folders include `models/`, `outputs/`, `recordings/`, `runtime/`, `whisper_cpp/bin_cpu/`, `whisper_cpp/bin_cuda/`, `whisper_cpp/bin_vulkan/`, `whisper_cpp/models/`, `whisper_cpp/output/`, `electron_app/node_modules/`, `electron_app/out/`, and Electron build output folders.

`whisper_cpp/bin_openvino/` is intentionally not ignored in this repo so the OpenVINO NPU/GPU runtime can be shipped with the app. `whisper_cpp/build_openvino/` is a local CMake build tree and should not be needed for normal users.

## Backend Scripts

```text
python_backend/record_audio.py          records Windows system loopback audio
python_backend/live_transcribe.py       records chunks and writes a live faster-whisper transcript
python_backend/transcribe_audio.py      batch transcribes an existing audio file with faster-whisper
python_backend/post_transcribe_qwen.py  post-processes a recording with Qwen3-ASR
python_backend/download_assets.py       downloads ignored local models and whisper.cpp runtime files
python_backend/whisper_models.py        resolves local faster-whisper model paths
python_backend/repair_wav_header.py     repairs WAV RIFF/data sizes before post transcription
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
drop a .wav file onto test\drop_vulkan.bat
drop a .wav file onto test\drop_openvino_npu.bat
drop a .wav file onto test\drop_openvino_gpu.bat
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
  bin_openvino/
  models/
```

Do not commit model files to normal Git history. Use releases, external storage, or Git LFS if distribution is needed later.

`bin_cpu/`, `bin_cuda/`, and the ggml models can be downloaded by the asset downloader.
`bin_vulkan/` and `bin_vulkan_loopback/` are local build artifacts. The Setup tab
checks whether they exist, but it does not download them. Build or copy them locally
before using `CPP Vulkan`, `CPP Vulkan LB Base`, or `CPP Vulkan LB Small`.

`bin_openvino/` contains the separate OpenVINO whisper.cpp runtime used by `CPP OV NPU`
and `CPP OV GPU`. It is copied into the folder-style portable package when present.
The OpenVINO encoder files are expected beside the ggml model:

```text
whisper_cpp/models/ggml-small-encoder-openvino.xml
whisper_cpp/models/ggml-small-encoder-openvino.bin
```

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
live_cpp_server_vulkan.cmd
live_cpp_server_openvino.cmd
live_cpp_server_openvino_gpu.cmd
stream_cpp.cmd
transcribe_cpp.cmd ..\test\demo.wav output\demo
```

This folder is for comparing whisper.cpp latency and CPU/GPU behavior against the Python faster-whisper workflow.

`live_cpp_cpu.cmd` uses the same SoundCard loopback capture as the Python live workflow, but it calls `whisper-cli.exe` once per chunk. The thread count is auto-selected from the local CPU unless `--threads` is passed.

`live_cpp_server_cpu.cmd` is the preferred whisper.cpp CPU live path. It uses the same SoundCard loopback capture, starts `whisper-server.exe` as a child process, posts each chunk to `/inference`, and appends the returned text to `live_transcript.txt`. This keeps the model resident without losing the app's Windows speaker loopback selection.

`live_cpp_server_vulkan.cmd` uses the same resident-server path with the Vulkan build.
`select_vulkan_device.cmd` checks available Vulkan devices and sets
`GGML_VK_VISIBLE_DEVICES` when a suitable device is selected.

`live_cpp_server_openvino.cmd` uses OpenVINO with `-oved NPU`.
`live_cpp_server_openvino_gpu.cmd` uses OpenVINO with `-oved GPU`.
Both keep the model server resident and use the app's Python loopback capture.

`stream_cpp.cmd` is only a standalone experiment. It uses `whisper-stream.exe`, which keeps the model resident but uses SDL capture devices instead of the app's Windows loopback selector. If SDL only lists a microphone, this path will not capture Teams/browser speaker audio.

The custom Vulkan loopback build is different from upstream `whisper-stream.exe`.
It captures the Windows output device through WASAPI loopback and supports:

```text
--save-wav path\to\audio.wav
```

The Electron loopback live buttons pass both `-f live_transcript.txt` and
`--save-wav audio.wav`, so loopback live sessions can be post-transcribed later.

No-sound whisper.cpp CPU file test:

```powershell
whisper_cpp\bin_cpu\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f test\audio.wav -l ja -otxt -of test\audio_cpp_cpu_sim -t 6 -ng
```

OpenVINO file tests:

```powershell
test\drop_openvino_npu.bat test\audio.wav
test\drop_openvino_gpu.bat test\audio.wav
```

OpenVINO post-transcription uses small model settings optimized for this repo:

```text
-oved NPU/GPU -t 8 -bs 1 -bo 1 -nf -nt -np
```

The Electron app repairs WAV headers before post-transcription for whisper.cpp and
Qwen jobs. This helps with live recordings whose RIFF/data sizes were not finalized
before the post command starts:

```powershell
repair_wav_header.cmd outputs\some_session\audio.wav
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

When present, the portable folder also copies:

```text
whisper_cpp/bin_vulkan/
whisper_cpp/bin_vulkan_loopback/
whisper_cpp/bin_openvino/
```

The release zip is built from the folder-style portable package and uploaded to the
GitHub Release page for the matching tag.

The Electron main process uses two roots:

- code root: folder containing `python_backend/record_audio.py`
- data root: folder beside the portable exe when it contains `settings.json`; otherwise the repo root

Relative output/model/settings paths resolve against the data root.
