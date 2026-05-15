# Local Meeting STT

Local meeting recording and speech-to-text tools for Windows.

The main workflow records system audio, writes a live transcript, and keeps meeting artifacts together in a timestamped folder.

## Main Commands

Desktop control panel:

```powershell
cd electron_app
npm install
npm run dev
```

Live meeting mode:

```powershell
live_meeting.cmd
```

This records system audio and creates:

```text
recordings/
  live_meeting_YYYYMMDD_HHMMSS/
    audio.wav
    live_transcript.txt
```

Lower live delay:

```powershell
live_meeting.cmd --chunk-seconds 3
```

Audio-only recording:

```powershell
record_meeting.cmd --until-enter
```

Batch transcription with faster-whisper:

```powershell
uv run --with faster-whisper python transcribe_audio.py audio.wav --model small
```

Post-meeting Qwen3-ASR transcript:

```powershell
post_transcribe_qwen.cmd recordings\meeting.wav
```

Drag-and-drop Qwen transcript:

```text
drop a .wav file onto drop_qwen_gpu.bat
drop a .wav file onto drop_qwen_cpu.bat
```

Drag-and-drop whisper.cpp transcript:

```text
drop a .wav file onto drop_cpp_gpu.bat
drop a .wav file onto drop_cpp_cpu.bat
```

## Electron App

An Electron + React + Vite desktop control panel lives in:

```text
electron_app/
```

It is the easiest way to run the current toolkit. The app keeps the existing scripts as the backend instead of rewriting STT logic.

Current UI:

- `Live`: Python live recording/transcript, Python live text only, whisper.cpp CPU/GPU live.
- `Record`: audio-only recording until Enter or for a timed duration.
- `Transcribe`: select or drop an audio file, then run whisper.cpp CPU/GPU or Qwen CPU/GPU.
- `Setup`: check/download local assets and choose Windows speaker loopback / microphone devices.

Useful app controls:

- `Ctrl+B` toggles the sidebar between full labels and compact icons.
- Setup audio selectors use `record_audio.py --list-devices` and pass selected device ids to live/record commands.
- Process logs and live transcript/output paths stay visible in the right-side panel.

Build check:

```powershell
cd electron_app
npm run build
```

## What Each Script Does

```text
record_audio.py          records Windows system loopback audio
live_transcribe.py       records system audio and writes live faster-whisper transcript
transcribe_audio.py      batch transcribes an existing audio file
post_transcribe_qwen.py  post-processes a recording with Qwen3-ASR
```

The `.cmd` files are wrappers that run the Python scripts through `uv` with the needed temporary dependencies.

## Models

Model files are intentionally ignored by Git.

Download the local assets after cloning:

```powershell
uv run --with huggingface-hub python download_assets.py
```

Download only the `whisper.cpp` assets:

```powershell
uv run --with huggingface-hub python download_assets.py --skip-faster-whisper --skip-qwen
```

Download to another folder with the same layout:

```powershell
uv run --with huggingface-hub python download_assets.py --target-root D:\meeting-stt-assets
```

The default repo-root download is recommended. If `--target-root` points outside this repo, pass explicit model/runtime paths to the scripts when using those external assets.

Expected local folders when downloaded:

```text
models/
  faster-whisper-small/
  Qwen3-ASR-0.6B/
```

`whisper.cpp` downloads use separate runtime folders:

```text
whisper_cpp/
  bin_cpu/
  bin_cuda/
  models/
```

The scripts still work with normal Hugging Face cache downloads if these folders are missing.

Do not push model files to normal GitHub history. Use GitHub Releases, external storage, or Git LFS if model distribution is needed.

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
transcribe_cpp.cmd ..\demo.wav output\demo
```

This folder is for comparing `whisper.cpp` latency and CPU/GPU behavior against the main Python `faster-whisper` workflow.

## Notes

- Default language is Japanese.
- Main capture target is Windows system audio, suitable for Teams/meeting audio.
- Optional mic mixing is available from the scripts and Electron Setup page.
- Live transcript is rough and low-latency.
- Post-meeting transcription should be used for a cleaner final transcript.
