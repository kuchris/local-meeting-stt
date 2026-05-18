# whisper.cpp

This folder is for testing `whisper.cpp` separately from the current Python workflow.

Current production-ish workflow stays in the repo root:

```text
python_backend/live_meeting.cmd
python_backend/live_transcribe.py
python_backend/record_audio.py
python_backend/transcribe_audio.py
```

Use this folder for `whisper.cpp` runtime files and experiments:

```text
whisper_cpp/
  README.md
  bin_cpu/   whisper.cpp CPU executables
  bin_cuda/  whisper.cpp CUDA executables
  models/    whisper.cpp ggml models
  output/    test transcripts
```

## Goal

Test whether `whisper.cpp` gives lower-latency live captions than the current Python `faster-whisper` chunk loop.

## Current Setup

Downloaded:

```text
bin_cpu/Release/whisper-cli.exe
bin_cpu/Release/whisper-server.exe
bin_cpu/Release/whisper-stream.exe
bin_cuda/Release/whisper-cli.exe
bin_cuda/Release/whisper-server.exe
bin_cuda/Release/whisper-stream.exe
models/ggml-small.bin
```

This setup supports both CPU-only and CUDA 12.4 Windows builds from `ggml-org/whisper.cpp` `v1.8.4`.

Batch test on `../test/demo.wav` worked and used the RTX 4080 Laptop GPU.

Observed test result:

```text
Input duration: 439.9 sec
Total processing time: about 29.8 sec
Model: ggml-small.bin
Language: Japanese
Output: output/demo_whisper_cpp_small.txt
```

## Commands

Batch file transcription:

```cmd
transcribe_cpp.cmd ..\test\demo.wav output\demo_whisper_cpp_small
```

Streaming:

```cmd
stream_cpp.cmd
```

This is an experimental mic/SDL path. It keeps the model resident, but it may only see microphone devices. Use it for testing or a virtual audio capture device.

Recommended system-audio live:

```cmd
live_cpp.cmd
```

CPU-only test:

```cmd
live_cpp_cpu.cmd
```

The CPU wrapper defaults to `--chunk-seconds 3 --gain 2.0` and auto-selects a live thread count from the local CPU. You can still override it with `--threads 4`, `--threads 6`, etc.

Preferred CPU live path with a resident whisper.cpp model:

```cmd
live_cpp_server_cpu.cmd
```

This keeps `whisper-server.exe` running during the live session, while `live_cpp.py` still captures the selected Windows speaker loopback through SoundCard. It avoids the per-chunk model reload cost from `whisper-cli.exe`.

If the saved `audio.wav` is still too quiet, raise gain:

```cmd
live_cpp_cpu.cmd --gain 3.0
```

If the audio sounds distorted, lower gain:

```cmd
live_cpp_cpu.cmd --gain 1.5
```

This uses the same Windows SoundCard loopback capture as the Python live workflow, but sends each chunk to `whisper-cli.exe`. Use this when `stream_cpp.cmd` only hears the wrong microphone or prints repeated non-speech text.

`stream_cpp.cmd` selects SDL capture device `-c 0` by default. Check the startup log to see what SDL detected. Example output may look like:

```text
#0 Microphone Array
```

If another SDL capture ID is the source you want, override it:

```cmd
stream_cpp.cmd -c 3
```

To use the default SDL microphone instead:

```cmd
stream_cpp_mic.cmd
```

The streaming wrapper uses:

```text
--step 1000
--length 3000
--keep 500
```

This should feel lower latency than the chunked CLI loop, but device capture is the big limitation. `whisper-stream.exe` uses SDL capture devices, so it does not see the same Windows loopback list as the Python SoundCard script. If it only hears silence/noise, Whisper may hallucinate common phrases such as Japanese outro text.

No-sound file benchmark:

```cmd
bin_cpu\Release\whisper-cli.exe -m models\ggml-small.bin -f ..\test\audio.wav -l ja -otxt -of ..\test\audio_cpp_cpu_sim -t 6 -ng
```

If Japanese text appears like mojibake in `cmd.exe`, the wrapper runs `chcp 65001` to switch the console to UTF-8.

## Notes

- `whisper.cpp` models are different files from `faster-whisper` models.
- Do not mix `models/faster-whisper-small` with `whisper.cpp`; `whisper.cpp` usually expects `ggml` model files.
- Keep comparing latency and Japanese transcript quality against the Python live workflow.
