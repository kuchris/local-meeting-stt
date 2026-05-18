# whisper.cpp Vulkan Loopback Technical Reference

## Scope

This document describes the custom `whisper.cpp` executable used by this project
for live transcription from a Windows output device.

The executable is not the upstream SDL microphone stream sample. It is a custom
Windows WASAPI render-loopback build that captures speaker/headset output and runs
Whisper inference through the Vulkan backend.

Primary binary:

```text
whisper_cpp/bin_vulkan_loopback/Release/whisper-stream-loopback.exe
```

Primary use case:

```text
Windows output-device audio -> WASAPI loopback -> whisper.cpp Vulkan -> Electron live transcript
```

## Component Contract

The loopback executable is responsible for:

- Enumerating Windows render/output devices.
- Capturing audio from the selected render device through WASAPI loopback.
- Running `whisper.cpp` inference with Vulkan enabled.
- Emitting transcript text to stdout for the Electron process log and live view.
- Writing final transcript lines to the `-f` output file.
- Applying local suppression for common live hallucinations and degenerate repetition loops.

The Electron app is responsible for:

- Launching the correct `.cmd` wrapper.
- Passing the timestamped output file path through `-f`.
- Displaying Process log output.
- Displaying Live transcript output.
- Adding GUI-side `[HH:MM:SS]` timestamps to displayed log/transcript lines.

## Source Layout

The local development copy is:

```text
whisper_cpp/src_vulkan_loopback/
```

That folder is a copied `whisper.cpp` checkout with the custom loopback example.
It is the source copy to keep in Git when the custom build needs to be reproducible.

The custom example directory is:

```text
whisper_cpp/src_vulkan_loopback/examples/stream-loopback/
```

Important source files:

```text
examples/stream-loopback/stream-loopback.cpp
examples/stream-loopback/common-wasapi-loopback.cpp
examples/stream-loopback/common-wasapi-loopback.h
```

The CMake build output is expected at:

```text
whisper_cpp/build_vulkan_loopback/bin/Release/whisper-stream-loopback.exe
```

After building, copy the executable into this repository:

```text
whisper_cpp/bin_vulkan_loopback/Release/whisper-stream-loopback.exe
```

This binary is intentionally treated as a local build artifact. Keep it ignored by
Git and rebuild or copy it locally when needed.

## Runtime Launchers

The Electron UI exposes two Vulkan loopback launchers:

```text
whisper_cpp/stream_cpp_vulkan_loopback_base.cmd
whisper_cpp/stream_cpp_vulkan_loopback_small.cmd
```

Both wrappers force the Vulkan runtime to expose only the Intel iGPU:

```cmd
set "GGML_VK_VISIBLE_DEVICES=1"
```

This matters on machines that also have a discrete GPU. The loopback app is intended
to use the Intel iGPU for this workflow.

### Base Model Launcher

```cmd
bin_vulkan_loopback\Release\whisper-stream-loopback.exe -m models\ggml-base.bin -l ja -t 4 --step 0 --length 5000 --keep 250 --vad-check 750 -vth 0.55 -fth 150 -nf --plain -f output\stream_cpp_vulkan_loopback_base.txt %*
```

Use this when latency and stability are more important than accuracy.

### Small Model Launcher

```cmd
bin_vulkan_loopback\Release\whisper-stream-loopback.exe -m models\ggml-small.bin -l ja -t 4 --step 0 --length 5000 --keep 250 --vad-check 750 -vth 0.55 -fth 150 -nf --plain -f output\stream_cpp_vulkan_loopback_small.txt %*
```

Use this when Japanese recognition accuracy is more important than latency.

## Runtime Configuration

Current stable configuration:

```text
--step 0 --length 5000 --keep 250 --vad-check 750 -vth 0.55 -fth 150 -nf --plain
```

Parameter rationale:

| Option | Purpose |
| --- | --- |
| `--step 0` | Enables VAD pause-based transcription instead of fixed sliding windows. |
| `--length 5000` | Caps the utterance buffer at 5 seconds. |
| `--keep 250` | Keeps a small boundary cushion between segments. |
| `--vad-check 750` | Checks for speech/pause state frequently enough for live use. |
| `-vth 0.55` | Uses a conservative VAD threshold to reduce false triggers. |
| `-fth 150` | Applies high-pass filtering to reduce low-frequency noise/music energy. |
| `-nf` | Disables temperature fallback to reduce latency and hallucinations. |
| `--plain` | Emits plain transcript text instead of verbose transcription blocks. |

Do not use `--hybrid` for the default app path. It produced unstable replacement
behavior in the GUI during live testing. Keep it only for explicit experiments with
`@@PARTIAL` / `@@FINAL` markers.

## Output Format

The executable writes transcript lines to the `-f` file with wall-clock timestamps:

```text
[15:04:12] transcript text
```

The Electron renderer also timestamps displayed Process log and Live transcript lines.
The GUI timestamp and file timestamp are generated independently, so a one-second
difference is normal.

## Build Requirements

Required tools:

- Visual Studio 2022 C++ build tools.
- CMake.
- Vulkan SDK.
- A `whisper.cpp` checkout containing the custom `examples/stream-loopback` target.

Build placeholders:

```text
<VSDEVCMD> = Visual Studio VsDevCmd.bat
<VULKAN_SDK> = Vulkan SDK install folder
```

## Build Procedure

Run from the repository root in PowerShell.

### Step 1: Check The Local Source Exists

```powershell
Test-Path whisper_cpp\src_vulkan_loopback\examples\stream-loopback\stream-loopback.cpp
```

Expected result:

```text
True
```

If this is `False`, copy or restore the custom `whisper.cpp` source into
`whisper_cpp/src_vulkan_loopback/` first.

### Step 2: Configure CMake

```powershell
cmd /d /c 'call "<VSDEVCMD>" -arch=x64 && set VULKAN_SDK=<VULKAN_SDK> && set PATH=<VULKAN_SDK>\Bin;%PATH% && cmake -S whisper_cpp\src_vulkan_loopback -B whisper_cpp\build_vulkan_loopback -DGGML_VULKAN=ON -DGGML_CCACHE=OFF'
```

This creates the ignored local build cache:

```text
whisper_cpp/build_vulkan_loopback/
```

### Step 3: Build The Loopback Target

```powershell
cmd /d /c 'call "<VSDEVCMD>" -arch=x64 && set VULKAN_SDK=<VULKAN_SDK> && set PATH=<VULKAN_SDK>\Bin;%PATH% && cmake --build whisper_cpp\build_vulkan_loopback --config Release --target whisper-stream-loopback'
```

Expected output executable:

```text
whisper_cpp/build_vulkan_loopback/bin/Release/whisper-stream-loopback.exe
```

### Step 4: Copy Runtime Files Into `bin_vulkan_loopback`

Create the runtime folder:

```powershell
New-Item -ItemType Directory -Force whisper_cpp\bin_vulkan_loopback\Release
```

Copy the rebuilt executable:

```powershell
Copy-Item -LiteralPath whisper_cpp\build_vulkan_loopback\bin\Release\whisper-stream-loopback.exe -Destination whisper_cpp\bin_vulkan_loopback\Release\whisper-stream-loopback.exe -Force
```

If this is a fresh build, also copy required runtime DLLs from the build output:

```powershell
Copy-Item -LiteralPath whisper_cpp\build_vulkan_loopback\bin\Release\*.dll -Destination whisper_cpp\bin_vulkan_loopback\Release\ -Force
```

If the build output contains SDL2 or other support DLLs outside `bin/Release`, copy
them into `whisper_cpp/bin_vulkan_loopback/Release/` as well. The executable must be
able to start from that folder without relying on the build cache.

### Step 5: Verify The Installed Binary

```powershell
cmd /d /c "cd /d whisper_cpp && stream_cpp_vulkan_loopback_base.cmd --help"
```

Expected signs:

```text
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = Intel(R) RaptorLake-S Mobile Graphics Controller
--plain         [true]
--step          [0]
-m FNAME        [models\ggml-base.bin]
```

### Step 6: Build The Electron App

```powershell
cd electron_app
npm run build
```

Or build the portable folder from the repo root:

```powershell
build_portable_folder.cmd
```

The portable build copies `whisper_cpp/bin_vulkan_loopback/` into the portable app
when that folder exists.

### Fast Rebuild After Editing C++ Only

After the first configure, repeat only:

```powershell
cmd /d /c 'call "<VSDEVCMD>" -arch=x64 && set VULKAN_SDK=<VULKAN_SDK> && set PATH=<VULKAN_SDK>\Bin;%PATH% && cmake --build whisper_cpp\build_vulkan_loopback --config Release --target whisper-stream-loopback'
Copy-Item -LiteralPath whisper_cpp\build_vulkan_loopback\bin\Release\whisper-stream-loopback.exe -Destination whisper_cpp\bin_vulkan_loopback\Release\whisper-stream-loopback.exe -Force
```

## Verification

Verify the base launcher:

```powershell
cmd /d /c "cd /d whisper_cpp && stream_cpp_vulkan_loopback_base.cmd --help"
```

Expected properties:

```text
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = Intel(R) RaptorLake-S Mobile Graphics Controller
--plain         [true]
--step          [0]
--length        [5000]
-m FNAME        [models\ggml-base.bin]
```

Verify the small launcher:

```powershell
cmd /d /c "cd /d whisper_cpp && stream_cpp_vulkan_loopback_small.cmd --help"
```

Expected model:

```text
-m FNAME        [models\ggml-small.bin]
```

If both NVIDIA and Intel Vulkan devices appear, the wrapper is not constraining
`GGML_VK_VISIBLE_DEVICES` as expected.

## Electron Integration

Renderer buttons:

```text
CPP Vulkan LB Base
CPP Vulkan LB Small
```

Electron command kinds:

```text
live-cpp-stream-loopback-base
live-cpp-stream-loopback-small
```

Output files:

```text
outputs/loopback_stream_base_YYYYMMDD_HHMMSS/live_transcript.txt
outputs/loopback_stream_small_YYYYMMDD_HHMMSS/live_transcript.txt
```

## Troubleshooting

### Vulkan SDK Not Found

Failure:

```text
Could NOT find Vulkan (missing: Vulkan_LIBRARY Vulkan_INCLUDE_DIR glslc)
```

Cause:

```text
The build shell does not have Vulkan SDK environment variables.
```

Fix:

```cmd
set VULKAN_SDK=<VULKAN_SDK>
set PATH=<VULKAN_SDK>\Bin;%PATH%
```

### Visual Studio Batch File Quoting

Use `call "<VSDEVCMD>"` inside `cmd /d /c`.

Avoid this quoting shape:

```powershell
cmd /d /c ""<VSDEVCMD>" -arch=x64 && ..."
```

It can be parsed incorrectly on Windows when the path contains spaces.

### Wrong Capture Behavior

If the executable lists only microphone/capture devices, the wrong binary is being
used. The correct binary must be:

```text
whisper-stream-loopback.exe
```

Do not replace it with upstream:

```text
whisper-stream.exe
```

The upstream stream sample does not provide the required render-device loopback
behavior for this app.

## Related Documentation

Runtime tuning details:

```text
docs/stream-mode-tuning.md
```
