# Local Meeting STT

Windows desktop app for recording meeting audio and creating local transcripts.

The main target is Teams or browser meeting audio. The app records system audio through Windows loopback, can optionally mix your microphone, and can run either live rough transcription or post-meeting transcription.

![Local Meeting STT app preview](docs/preview.svg)

## What You Can Do

- Record a meeting as a `.wav` file.
- Watch a rough live transcript while the meeting runs.
- Transcribe an existing audio file after the meeting.
- Use whisper.cpp CPU/GPU or Qwen3-ASR CPU/GPU from one UI.
- Keep recordings, logs, and transcripts local.

## Start The App

Requirements:

- Windows
- `uv`

Recommended:

```text
open_electron_app.cmd
```

Double-click this file from the repo root. If a packaged app already exists, it opens that app. Otherwise, it starts the Electron app in development mode.

Portable app:

```text
electron_app/dist/Local Meeting STT portable/Local Meeting STT.exe
```

Build this folder with:

```text
build_portable_folder.cmd
```

The folder-style portable package includes the app, backend scripts, `settings.json`, empty model/output folders, and a local `runtime/` folder. Zip the whole folder if you want to share it.

Developer run:

```powershell
cd electron_app
npm install
npm run dev
```

Developer run requires Node.js / npm.

If this is the first time using the app, open the `Setup` tab and download the assets you need.

## Which Assets Do I Need?

You do not need every asset for every mode.

```text
CPP CPU       -> whisper.cpp CPU + whisper.cpp small model
CPP Server    -> whisper.cpp CPU + whisper.cpp small model
CPP GPU       -> whisper.cpp CUDA + whisper.cpp small model
Live Text     -> faster-whisper small
Live + WAV    -> faster-whisper small
Qwen CPU/GPU  -> Qwen3-ASR
```

In the `Setup` tab, each asset row has its own download button. Use those row buttons when you only want one mode, such as CPP CPU.

Asset downloads run per row. Each row has its own progress bar and a pause/cancel button while downloading. Starting the same row again resumes or retries where the downloader/cache allows.

## App Tabs

### Live

Use this during a meeting.

- `Live + WAV`: records audio and writes a rough live transcript.
- `Live Text`: rough live transcript only.
- `CPP GPU`: whisper.cpp live transcription with GPU build.
- `CPP CPU`: whisper.cpp live transcription with CPU build.
- `CPP Server`: whisper.cpp CPU live transcription with a resident server process. This keeps the model loaded while still using the selected Windows speaker loopback.

Lower `Chunk seconds` for lower delay. Higher values are usually more stable.

### Record

Use this when you only want a clean audio recording.

- `Until Enter`: record until you stop it.
- `Timed WAV`: record for the number of seconds shown.

### Transcribe

Use this after a meeting.

Drop or choose an audio file, then run:

- `CPP GPU` / `CPP CPU` for faster whisper.cpp transcription.
- `Qwen GPU` / `Qwen CPU` for Qwen3-ASR post-processing.

Qwen can be slower and use more VRAM, but it is useful to compare final transcript quality.

For a quick whisper.cpp CPU file test without opening or playing sound:

```powershell
whisper_cpp\bin_cpu\Release\whisper-cli.exe -m whisper_cpp\models\ggml-small.bin -f test\audio.wav -l ja -otxt -of test\audio_cpp_cpu_sim -t 6 -ng
```

### Setup

Use this to prepare the local machine.

- Check whether models and whisper.cpp binaries exist.
- Download all assets or download one missing asset from its row.
- Choose and open the output folder.
- Choose the Windows speaker loopback device.
- Enable optional microphone mixing.

Blank audio device selection means the default device is used.

## Useful Controls

- `Ctrl+B`: collapse or expand the sidebar.
- `File > Open Audio...`: choose an audio file for post-transcription.
- `View > Clear Logs`: clear the process log and live transcript panel.
- `Help > GitHub Repository`: open the project repository.

## Output Folders

The Electron app writes recordings and transcripts to one output folder. The default is:

```text
outputs/
```

You can change it from the `Setup` tab.

Live meeting output:

```text
outputs/
  live_meeting_YYYYMMDD_HHMMSS/
    audio.wav
    live_transcript.txt
```

Post-transcription output is also written to the selected output folder.

The app also scans session folders in the selected output folder. A session is detected when it contains:

```text
audio.wav
```

Post-transcription results for session audio are written back into that same session folder.

Test/demo files live in:

```text
test/
```

Local model files, recordings, generated transcripts, and Electron build/cache files are ignored by Git.

Portable settings are stored in:

```text
settings.json
```

Runtime/cache data is stored in:

```text
runtime/
```

Both are local/user state and are ignored by Git.

## Notes

- Default language is Japanese.
- Main capture source is system audio, suitable for Teams/browser meeting audio.
- Live transcript is for low-latency checking, not final quality.
- For cleaner final output, record first and run post-transcription after the meeting.

For backend commands, folder layout, and technical details, see [TECHNICAL.md](TECHNICAL.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

## Support

If this project saves you time, please consider giving it a GitHub star. It helps other people find the repo.

[![Star History Chart](https://api.star-history.com/svg?repos=kuchris/local-meeting-stt&type=Date)](https://www.star-history.com/#kuchris/local-meeting-stt&Date)
