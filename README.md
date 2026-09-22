<p align="center">
  <img src="docs/icon.png" width="96" alt="Local Meeting STT icon">
</p>

# Local Meeting STT

A Windows desktop app for local meeting captions, audio recording, and
post-meeting transcription. Capture Teams, browser meetings, or other desktop
audio through speaker/headset loopback, with optional microphone mixing.
Recordings and recognition stay on your computer.

**English is the default interface language.** Switch to Traditional Chinese or
Japanese in the title bar. The app remembers your choice. Interface language is
separate from recognition language: the supplied workflows recognize Japanese.

![English meeting interface](docs/meeting-ui.png)

*Current interface with test caption text; this is not a real meeting recording.*

## Get started

Requirements for running from source:

- Windows, Node.js/npm, and [uv](https://docs.astral.sh/uv/).
- Local model files and the runtime for your selected backend.
- An NVIDIA GPU for CUDA; other backends have their own hardware requirements.

```powershell
cd electron_app
npm ci
npm run dev
```

1. Open **Settings & models** and check/download the files you need.
2. In **Live meeting**, select a model and your system audio source.
3. Optionally enable **Include microphone** and select the microphone.
4. Open **Details** to choose a backend and audio chunk duration.
5. Select **Start meeting**. **Stop current task** remains available on every page.

A fresh configuration uses Whisper small with faster-whisper on CPU. For a
compatible NVIDIA system, select the whisper.cpp CUDA backend in Details.
Whisper base is available through the existing Vulkan loopback backend.

The first setup may download dependencies and model files. Once installed,
recognition uses local models rather than a cloud ASR service. A running process
is not proof that audio is arriving; check the transcript and process log.

[Portable releases](https://github.com/kuchris/local-meeting-stt/releases) are also
available. Published packages may predate the current source interface. The root
`open_electron_app.cmd` launcher opens an existing packaged app when present;
use `npm run dev` above to try your current checkout.

## Pages

| Page | What it does |
| --- | --- |
| Live meeting | Large live transcript, model/audio controls, optional WAV recording, and collapsible diagnostics. |
| Record audio | Save audio for later transcription, with optional duration limit. |
| Recordings & transcripts | Choose a recording or drop an audio file, then select a model and backend. |
| Settings & models | Inspect/download assets and set the output folder. |

The live model choices are **Whisper small** and **Whisper base**. Post-meeting
transcription offers **Whisper small** and **Qwen3-ASR 0.6B**. Qwen is currently a
file-transcription option, not a live-caption backend.

The selected post-transcription backend is saved. Switching between Whisper and
Qwen preserves CPU/CUDA preference. When no post preference exists, an existing
CUDA live configuration initializes transcription to CUDA; other configurations
start on CPU. An explicit saved CPU choice is preserved.

## Backends and local assets

| Backend | Local files | Notes |
| --- | --- | --- |
| faster-whisper | `models/faster-whisper-small/` | CPU by default; live captions with optional WAV. |
| whisper.cpp CPU | `whisper_cpp/bin_cpu/Release/` + `ggml-small.bin` | Live server and file transcription. |
| whisper.cpp CUDA | `whisper_cpp/bin_cuda/Release/` + `ggml-small.bin` | NVIDIA GPU; live server and file transcription. |
| whisper.cpp Vulkan | `whisper_cpp/bin_vulkan/Release/` + `ggml-small.bin` | Resident live server and file transcription. |
| OpenVINO NPU/GPU | `whisper_cpp/bin_openvino/Release/` + small model and encoder XML/BIN | Requires a compatible OpenVINO device and local build. |
| Vulkan loopback | `whisper_cpp/bin_vulkan_loopback/Release/` + base or small model | System default loopback only; no custom device or microphone mixing. |
| Qwen CPU/CUDA | `models/Qwen3-ASR-0.6B/` | File transcription; shared pinned Python runtime. |

The `ggml-*.bin` files belong in `whisper_cpp/models/`. Live CPU/CUDA paths need
`whisper-server.exe` as well as `whisper-cli.exe`. Asset checks verify paths, not
hardware compatibility or the integrity of every downloaded file. Vulkan and
OpenVINO runtimes are local/release artifacts rather than normal model downloads.

## Latency and stopping

Whisper CPU/CUDA live sessions keep one model server running for the meeting,
so each audio chunk does not reload the model. Models are released at session end.

The default audio chunk is 3 seconds. Recognition starts after a chunk has been
collected; try 2 seconds in Details for quicker updates, with potentially less
sentence context. The faster-whisper queue keeps one waiting chunk. If inference
falls behind, old caption chunks are dropped while WAV recording continues.

Python live/record jobs get up to 10 seconds to stop capture, close their WAV,
and release the model worker. If they do not exit, Electron terminates the process
tree. File transcription and native loopback jobs use forced termination.
Closing the app also waits for cleanup. Stopping may omit queued/partial captions
or interrupt unfinished output; use the saved recording for final transcription.

Qwen launchers share `python_backend/qwen-requirements.txt`, including
PyTorch 2.11 / CUDA 12.8 for compatible NVIDIA GPUs such as the RTX 5070 Ti.
The CPU option uses the same runtime with CPU inference. A GPU kernel check runs
before loading weights, and missing local models produce an explicit error.

See [backend diagnosis and measured checks](docs/backend-review.md). Public-file
replays and native Electron checks have passed; they do not establish accuracy
or capture reliability in a real meeting.

## Saved files and controls

Outputs default to `outputs/`. A live session typically contains:

```text
outputs/
  live_meeting_YYYYMMDD_HHMMSS/
    audio.wav
    live_transcript.txt
```

Folder prefixes vary by backend. Post-transcription of a session's `audio.wav`
writes the transcript into that session folder. Other imported audio writes its
transcript to the configured output folder.

- **Ctrl+O**: choose audio for transcription.
- **Ctrl+B**: collapse/expand the sidebar.
- **View > Clear logs**: clear diagnostics while keeping captions.
- **Details**: inspect backend output and change live backend/chunk settings.

`settings.json` stores the display language (`ui.locale`), post backend
(`post.kind`), capture devices, live mode, and output preferences. Saved language
choices are retained when upgrading; missing/invalid language settings use English.
Raw backend logs, device names, filenames, and transcript text are not translated.

## Build and verification

```powershell
cd electron_app
npm run build
```

See [Electron development and test instructions](electron_app/README.md) for
renderer tests, three-language layout checks, native settings/IPC tests, and
backend lifecycle/replay checks.

To build a folder-style portable app, run `build_portable_folder.cmd` from the
repository root. It creates `electron_app/dist/Local Meeting STT portable/` with
the executable, backend scripts, settings, and available local runtimes. Model
folders remain local assets. This source update does not publish a new release.

For command-line workflows and the backend directory layout, see
[TECHNICAL.md](TECHNICAL.md).

## ASR experiments

The separate [benchmark tools](benchmarks/README.md) compare Japanese accuracy
and latency without changing the app's model selection:

- [Whisper/Qwen measured results](docs/asr-benchmark/2026-09-22/REPORT.zh-TW.md).
- [Nemotron 3.5 streaming follow-up](docs/asr-benchmark/2026-09-22-nemotron/REPORT.zh-TW.md).

These are small clean-speech experiments, not meeting-quality guarantees.
Models, downloaded audio, private recordings, caches, and runtime environments
are excluded from Git.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Support

If this project is useful, a GitHub star helps others find it.

[![Star History Chart](https://api.star-history.com/svg?repos=kuchris/local-meeting-stt&type=Date)](https://www.star-history.com/#kuchris/local-meeting-stt&Date)
