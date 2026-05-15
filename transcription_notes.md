# Audio Transcription Notes

## Goal

Convert meeting audio, such as `.mp3`, into a plain text transcript.

Current workflow:

```text
audio.mp3
-> faster-whisper
-> audio_transcript.txt
```

No Word document is required for the current use case.

## Script

Reusable script:

```text
transcribe_audio.py
```

Basic command:

```powershell
uv run --with faster-whisper python transcribe_audio.py audio.mp3 -o audio_transcript.txt
```

The script uses `faster-whisper`, which is a Python library for running Whisper speech-to-text models.

## What Whisper Is

Whisper is the speech-to-text model/tool.

`faster-whisper` is the Python library used here to run Whisper models locally.

The short Python code is only a wrapper around the library:

```text
audio file
-> faster-whisper library
-> Whisper model
-> transcript text file
```

## Model Sizes Used Locally

On this machine, downloaded model cache sizes were approximately:

```text
base    141 MB
small   464 MB
medium  1.46 GB
```

The Python package itself is small. The model files are the main disk cost.

Model cache location:

```text
C:\Users\kuchris\.cache\huggingface\hub
```

## CPU vs GPU

GPU is not required.

The current script defaults to CPU:

```python
--device cpu
--compute-type int8
```

CPU command:

```powershell
uv run --with faster-whisper python transcribe_audio.py audio.mp3 -o audio_transcript.txt
```

GPU can be tried later with:

```powershell
uv run --with faster-whisper python transcribe_audio.py audio.mp3 --device cuda --compute-type float16
```

Practical rule:

```text
short audio + medium model on CPU = OK
long audio + medium/large model on CPU = slow
GPU + medium/large model = faster
```

## 30 Minute to 1 Hour Meetings

For longer meetings, use `medium` if accuracy matters:

```powershell
uv run --with faster-whisper python transcribe_audio.py meeting.mp3 --model medium -o meeting_transcript.txt
```

If CPU speed is a problem, use `small`:

```powershell
uv run --with faster-whisper python transcribe_audio.py meeting.mp3 --model small -o meeting_transcript.txt
```

Practical expectation:

```text
30 min audio: small or medium on CPU is acceptable
1 hour audio: medium on CPU may take a while
frequent meetings: GPU or smaller model is better
accurate meeting notes: medium model, then clean/summarize after
```

## Real-Time Transcription

The current script is batch transcription:

```text
audio file already exists
-> transcribe
-> write transcript
```

Real-time transcription needs a separate script:

```text
microphone/system audio
-> record 5-10 second chunks
-> transcribe each chunk
-> append to live_transcript.txt
```

Possible future script:

```text
live_transcribe.py
```

Likely libraries:

```text
sounddevice or pyaudio
faster-whisper
```

Practical real-time tradeoff:

```text
CPU + small model = maybe near real-time, lower accuracy
CPU + medium model = usually too slow for smooth real-time
GPU + small/medium = better
```

For accurate meeting notes, recording first and transcribing after the meeting is usually more reliable than real-time transcription.
