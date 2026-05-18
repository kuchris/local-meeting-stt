# Local Meeting STT

Windows desktop app for local meeting recording and speech-to-text.

The main target is Teams or browser meeting audio. The app captures Windows system
audio through loopback, can optionally mix your microphone, and can run live or
post-meeting transcription without sending recordings to a cloud service.

![Local Meeting STT app preview](docs/preview.svg)

## What You Can Do

- Record meeting audio as a local `.wav` file.
- Watch a live transcript while a meeting runs.
- Capture speaker/headset output with the custom whisper.cpp Vulkan loopback mode.
- Compare `base` and `small` whisper.cpp models from the same UI.
- Transcribe an existing audio file after the meeting.
- Use whisper.cpp, faster-whisper, or Qwen3-ASR workflows locally.
- Keep recordings, logs, transcripts, models, and runtime state on your machine.

## Recommended Live Mode

For current live meeting use, start with:

```text
CPP Vulkan LB Base
```

Use:

- `CPP Vulkan LB Base` for lower latency and stability.
- `CPP Vulkan LB Small` when Japanese recognition accuracy matters more than delay.

Both modes use the custom `whisper-stream-loopback.exe` build documented in:

```text
whisper_cpp/vulkan-loopback-custom-build.md
```

This is the output-device loopback path. Do not confuse it with upstream
`whisper-stream.exe`, which uses SDL capture devices and may only see microphones.

## Start The App

Requirements:

- Windows
- `uv`

Recommended launcher:

```text
open_electron_app.cmd
```

Double-click this file from the repo root. If a packaged app exists, it opens the
packaged app. Otherwise, it starts the Electron app in development mode.

Portable app:

```text
electron_app/dist/Local Meeting STT portable/Local Meeting STT.exe
```

Build the portable folder with:

```text
build_portable_folder.cmd
```

The folder-style portable package includes the app, backend scripts, local settings,
empty model/output folders, and a local runtime folder. Model files are still local
assets and are not committed to Git.

Developer run:

```powershell
cd electron_app
npm install
npm run dev
```

Developer run requires Node.js and npm.

On first run, open the `Setup` tab and download the assets needed for the mode you
want to use.

## Which Assets Do I Need?

You do not need every asset for every mode.

```text
CPP Vulkan LB Base   -> custom Vulkan loopback binary + ggml-base model
CPP Vulkan LB Small  -> custom Vulkan loopback binary + ggml-small model
CPP Vulkan           -> whisper.cpp Vulkan server binary + ggml-base model
CPP CPU              -> whisper.cpp CPU binary + ggml-small model
CPP GPU              -> whisper.cpp CUDA/Vulkan binary + ggml-small model
Live Text            -> faster-whisper small model
Live + WAV           -> faster-whisper small model
Qwen CPU/GPU         -> Qwen3-ASR model
```

In the `Setup` tab, each asset row has its own download button. Asset downloads run
per row and show progress independently.

The Vulkan rows are different:

- `whisper.cpp Vulkan` (`whisper_cpp/bin_vulkan/`) is a local build artifact.
- `whisper.cpp Vulkan loopback` (`whisper_cpp/bin_vulkan_loopback/`) is a custom
  local build artifact.

They are shown in Setup so you can see whether they exist, but they are not
downloaded by the asset downloader. Build or copy them locally before using the
Vulkan live buttons.

## App Tabs

### Live

Use this during a meeting.

- `CPP Vulkan LB Base`: stable output-device loopback live transcription with the
  base model.
- `CPP Vulkan LB Small`: output-device loopback live transcription with the small
  model.
- `CPP Vulkan`: whisper.cpp Vulkan server live path with Python loopback capture.
- `Live + WAV`: records audio and writes a rough faster-whisper live transcript.
- `Live Text`: rough faster-whisper live transcript only.
- `CPP GPU` / `CPP CPU`: older whisper.cpp live paths for comparison.

The live panel shows a timestamped transcript and a timestamped process log.

### Record

Use this when you only want a clean audio recording.

- `Until Enter`: record until you stop it.
- `Timed WAV`: record for the number of seconds shown.

### Transcribe

Use this after a meeting.

Drop or choose an audio file, then run:

- `CPP GPU` / `CPP CPU` for whisper.cpp transcription.
- `Qwen GPU` / `Qwen CPU` for Qwen3-ASR post-processing.

Qwen can be slower and use more VRAM, but it is useful to compare final transcript
quality.

Quick whisper.cpp CPU file test:

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

The Electron app writes recordings and transcripts to one output folder. The default
is:

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

Vulkan loopback output:

```text
outputs/
  loopback_stream_base_YYYYMMDD_HHMMSS/
    live_transcript.txt
  loopback_stream_small_YYYYMMDD_HHMMSS/
    live_transcript.txt
```

Post-transcription output is written to the selected output folder or back into the
session folder for `audio.wav`.

Test/demo files live in:

```text
test/
```

Local model files, recordings, generated transcripts, and Electron build/cache files
are ignored by Git.

Portable settings and runtime state:

```text
settings.json
runtime/
```

Both are local/user state and are ignored by Git.

## Notes

- Default language is Japanese.
- Main capture source is system audio, suitable for Teams/browser meeting audio.
- Live transcript is for low-latency checking, not final transcript quality.
- For cleaner final output, record first and run post-transcription after the meeting.
- The custom Vulkan loopback build is documented under `whisper_cpp/`.

For backend commands, folder layout, and technical details, see [TECHNICAL.md](TECHNICAL.md).

## License

Apache-2.0. See [LICENSE](LICENSE).

## Support

If this project saves you time, please consider giving it a GitHub star. It helps
other people find the repo.

[![Star History Chart](https://api.star-history.com/svg?repos=kuchris/local-meeting-stt&type=Date)](https://www.star-history.com/#kuchris/local-meeting-stt&Date)
