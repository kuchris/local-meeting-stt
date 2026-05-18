# Electron App

Electron + React + Vite control panel for the local meeting STT backend.

The app does not implement speech-to-text itself. It calls the existing Python, `.cmd`, `.bat`, and whisper.cpp workflows from the parent repo and streams logs back into the UI.

## Run

Double-click from the repo root:

```text
open_electron_app.cmd
```

If `electron_app/dist/win-unpacked/Local Meeting STT.exe` exists, the launcher opens the packaged app. Otherwise, it starts dev mode.

Or run manually:

```powershell
cd electron_app
npm install
npm run dev
```

## Build Check

```powershell
npm run build
```

## Package

```powershell
npm run dist
```

The app folder is written to `electron_app/dist/win-unpacked/`. Run `Local Meeting STT.exe` inside that folder.

To try a single portable `.exe` package later:

```powershell
npm run dist:portable
```

The `dev` and `preview` scripts clear `ELECTRON_RUN_AS_NODE` first. If that variable is set, Electron can start like plain Node and show a blank app window.

## Tabs

- `Live`: Python live + WAV, Python live text, whisper.cpp GPU live, whisper.cpp CPU live.
- `Record`: record until Enter or timed WAV recording.
- `Transcribe`: choose/drop an audio file and run whisper.cpp CPU/GPU or Qwen CPU/GPU.
- `Setup`: check assets, download all or one asset, choose the output folder, and choose audio capture devices.

## Controls

- `Ctrl+B`: toggle the sidebar between full labels and compact icons.
- `File > Open Audio...`: choose an audio file for post-transcription.
- `View > Clear Logs`: clear the process log and live transcript pane.
- `Setup > Output folder`: choose where recordings and transcripts are written. Default: `outputs/`.
- `Setup > Audio input`: choose Windows speaker loopback and optional microphone.

Blank device selection means "use the script default". When a specific device is selected, the app passes `--system-device`, `--include-mic`, and `--mic-device` to supported live/record commands.

## Backend Notes

The app resolves all backend paths relative to the parent repo folder. It does not bundle models, Python packages, or whisper.cpp binaries.

Local Electron cache/user data is written under the parent repo's ignored `.electron-user-data/` folder.

See the parent repo [TECHNICAL.md](../TECHNICAL.md) for backend commands, model folders, and asset download details.
