# Local Meeting Recording + STT Plan

## Summary

Build a small Windows/uv workflow for meeting transcription:

- Real-time-ish live transcript: record system audio from Teams using Windows loopback and transcribe chunks with `faster-whisper` `small`.
- Higher-quality post-pass transcript: run recorded audio through `Qwen/Qwen3-ASR-0.6B` after the meeting.
- Keep `Parakeet-TDT-0.6B-v3` out of the Japanese default path because NVIDIA's model card lists European languages, not Japanese. Document it as optional for supported languages only.

References:

- Parakeet v3 model card: https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- Qwen3-ASR model card: https://huggingface.co/Qwen/Qwen3-ASR-0.6B
- SoundCard loopback docs: https://soundcard.readthedocs.io/en/latest/

## Key Changes

- Add `record_audio.py`:
  - Records Windows system audio using WASAPI loopback via `soundcard`.
  - Default source: system audio, because Teams meeting audio mainly comes from speaker output.
  - Optional `--include-mic` flag records default microphone too and mixes it with system audio.
  - Writes timestamped `.wav` files under `recordings/`.
  - Uses mono 16 kHz output for ASR compatibility.
- Add `live_transcribe.py`:
  - Captures short chunks, default `10s`.
  - Uses `faster-whisper` model `small`.
  - Appends rough live transcript to `live_transcript.txt`.
  - Intended for speed, not final accuracy.
- Add `post_transcribe_qwen.py`:
  - Uses `qwen-asr` with `Qwen/Qwen3-ASR-0.6B`.
  - Runs after the meeting on the saved `.wav`.
  - Writes final transcript to `<recording_name>_qwen_transcript.txt`.
  - Uses CUDA by default when available.
- Add Windows wrappers:
  - `record_meeting.cmd`: records system audio to `recordings/`.
  - `live_transcribe.cmd`: starts live chunk recording + Whisper small transcript.
  - `post_transcribe_qwen.cmd`: runs Qwen3-ASR post-pass on a chosen recording.

## Commands

Use uv without adding project dependency files:

```powershell
uv run --with soundcard --with soundfile --with numpy --with soxr python record_audio.py --duration 3600
```

Live transcription:

```powershell
live_transcribe.cmd
```

Post-pass transcription:

```powershell
post_transcribe_qwen.cmd recordings\meeting_YYYYMMDD_HHMMSS.wav
```

Underlying Qwen command shape:

```powershell
uv run --with qwen-asr --with torch python post_transcribe_qwen.py recordings\meeting.wav --model Qwen/Qwen3-ASR-0.6B --language Japanese
```

## Test Plan

- Device check:
  - List available loopback devices.
  - Confirm the default speaker loopback is selected.
- Recording check:
  - Play Teams/YouTube audio for 10 seconds.
  - Run `record_audio.py --duration 10`.
  - Verify a `.wav` file is created and is not silent.
- Live STT check:
  - Run live script for a short sample.
  - Verify `live_transcript.txt` is appended while audio plays.
- Qwen post-pass check:
  - Run Qwen on the same short recording.
  - Verify output is non-empty Japanese text.
- Regression check:
  - Existing `transcribe_audio.py audio.mp3` still works.

## Assumptions

- Target language is Japanese.
- Main meeting source is Teams/system audio, not only microphone.
- Windows Python + uv is the desired runtime.
- Real-time transcript prioritizes low latency, so it uses Whisper small.
- Final transcript prioritizes accuracy, so it uses Qwen3-ASR post-pass.
- Parakeet is not the Japanese default because its official supported-language list does not include Japanese.
