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
  bin/       whisper.cpp executables
  models/    whisper.cpp ggml models
  output/    test transcripts
```

## Goal

Test whether `whisper.cpp` gives lower-latency live captions than the current Python `faster-whisper` chunk loop.

## Current Setup

Downloaded:

```text
bin_cpu/Release/whisper-cli.exe
bin_cuda/Release/whisper-cli.exe
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

Recommended system-audio live:

```cmd
live_cpp.cmd
```

CPU-only test:

```cmd
live_cpp_cpu.cmd
```

The CPU wrapper defaults to `--chunk-seconds 5 --threads 16 --gain 2.0` because `ggml-small.bin` can lag with very short chunks on CPU, `whisper.cpp` otherwise uses fewer CPU threads, and the saved loopback WAV can be quiet.

If the saved `audio.wav` is still too quiet, raise gain:

```cmd
live_cpp_cpu.cmd --gain 3.0
```

If the audio sounds distorted, lower gain:

```cmd
live_cpp_cpu.cmd --gain 1.5
```

This uses the same Windows SoundCard loopback capture as the Python live workflow, but sends each chunk to `whisper-cli.exe`. Use this when `stream_cpp.cmd` only hears the wrong microphone or prints repeated non-speech text.

`stream_cpp.cmd` selects capture device `-c 0` by default because this machine showed:

```text
#0 MOTIV Mix Virtual Output (Shure Virtual Audio)
#1 Headset Microphone (2- INZONE Buds - Chat)
#2 Microphone Array (Realtek(R) Audio)
#3 Microphone (4- Shure MV7+)
#4 Microphone (Steam Streaming Microphone)
```

If `#0` is not the Teams/system mix you want, override it:

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

This should feel lower latency than the Python 10-second chunk loop, but device capture still needs testing. `whisper-stream.exe` uses SDL capture devices, so it does not see the same Windows loopback list as the Python SoundCard script.

If Japanese text appears like mojibake in `cmd.exe`, the wrapper runs `chcp 65001` to switch the console to UTF-8.

## Notes

- `whisper.cpp` models are different files from `faster-whisper` models.
- Do not mix `models/faster-whisper-small` with `whisper.cpp`; `whisper.cpp` usually expects `ggml` model files.
- Keep comparing latency and Japanese transcript quality against the Python live workflow.
