# Electron Control Panel

Small Electron + React + Vite UI for the local meeting STT scripts in the parent repo.

The app is a control panel. It calls the working `.cmd`, `.bat`, Python, and `whisper.cpp` workflows from the repo root and streams logs back into the UI.

## Run

```powershell
cd electron_app
npm install
npm run dev
```

The `dev` script clears `ELECTRON_RUN_AS_NODE` first. If that variable is set, Electron starts like plain Node and the app window can appear blank.

## Build Check

```powershell
npm run build
```

## Tabs

- `Live`: Python live + WAV, Python live text, whisper.cpp GPU live, whisper.cpp CPU live.
- `Record`: record until Enter or timed WAV recording.
- `Transcribe`: choose/drop an audio file and run whisper.cpp CPU/GPU or Qwen CPU/GPU.
- `Setup`: check assets, download assets, open output folders, and choose audio capture devices.

## Controls

- `Ctrl+B`: toggle the sidebar between full labels and compact icons.
- `File > Open Audio...`: choose an audio file for post-transcription.
- `View > Clear Logs`: clear the process log and live transcript pane.
- `Setup > Audio input`: choose Windows speaker loopback and optional microphone.

The Setup device list is populated by:

```powershell
uv run --with soundcard --with soundfile --with numpy --with soxr python record_audio.py --list-devices
```

Blank device selection means "use the script default". When a specific device is selected, the app passes `--system-device`, `--include-mic`, and `--mic-device` to supported live/record commands.

## Backend Notes

The app resolves all backend paths relative to the parent repo folder. It does not bundle models, Python packages, or whisper.cpp binaries.

Local Electron cache/user data is written under the parent repo's ignored `.electron-user-data/` folder.
