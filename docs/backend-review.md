# Backend diagnosis — 2026-09-22

Implementation branch: `codex/electron-meeting-ui`. Existing app models are retained.

## Qwen GPU failure

Replayed `outputs/asr_benchmark/data/10020345318418093976.wav` through the
Electron launcher's original dependency arguments. PyTorch 2.5.1 / CUDA 12.1
reported that the RTX 5070 Ti (`sm_120`) was unsupported, then failed during
transcription with `CUDA error: no kernel image is available for execution on
the device`. Merely detecting CUDA was insufficient.

Electron and all Qwen batch launchers now share pinned core requirements:
qwen-asr 0.0.6, torch 2.11.0+cu128 and torchvision 0.26.0+cu128, Python 3.11.
The model remains the existing local Qwen3-ASR-0.6B. A real kernel preflight
catches incompatible GPUs before loading weights. Missing local models produce
an actionable error instead of silently fetching a remote model.

Both the shared launcher and the real Electron IPC path produced a nonempty
Japanese transcript. Loading/model-ready messages now distinguish startup from
inference. The CPU option was tested through model load and cancellation; full
CPU transcription speed was not benchmarked in this pass.

Upstream reference: [PyTorch Blackwell and CUDA 12.8 support](https://pytorch.org/blog/pytorch-2-7/).

## Whisper small latency

The selected `live-cpp-gpu` command launched a new whisper-cli process, loaded
small, transcribed one chunk, and exited for every chunk. The CUDA and CPU live
launchers now use one whisper-server per meeting, released when the meeting ends.
The model and beam/best-of settings stay the same.

Three consecutive 3-second segments of the same public Japanese sample:

| Measurement | Per-chunk CLI | Resident CUDA server |
| --- | ---: | ---: |
| First inference, including CLI startup | 1.271 s | 0.132 s |
| Median request duration | 0.650 s | 0.086 s |
| One-time server startup | — | 0.736 s |

The segment texts matched between the two paths. This small replay measures
processing overhead, not meeting accuracy or speech-to-screen latency. Capturing
a 3-second chunk still adds up to 3 seconds before inference; users can try
2 seconds in Details at the cost of less sentence context. No automatic change
to saved chunk preferences was made.

The faster-whisper fallback previously allowed 24 waiting chunks. It now keeps
one waiting chunk and reports overload drops; WAV recording remains independent
of dropped caption chunks. Both capture implementations propagate device failures
instead of leaving the main worker blocked on an empty queue.

## Stopping and resource release

Previously Stop used `taskkill /t /f`. It targeted the model process tree, but
provided no opportunity for Python to close the recording normally.

Python live/record jobs now receive a per-job stop-file path. Stop wakes an empty
audio queue, closes capture, closes the WAV and terminates the resident server.
Electron allows up to 10 seconds, then falls back to process-tree termination.
Native loopback and post-transcription jobs still use direct forced termination.
The app waits for cleanup before exiting; repeated quit requests cannot bypass
an in-progress cleanup. Model state is not retained between meetings.

Checks performed:

- Real Whisper CUDA inference with a simulated device fed public-file audio:
  cooperative stop about 0.200 s, valid finalized WAV, no remaining model child.
- Native Electron Qwen GPU: successful transcript through actual preload/IPC.
- Native Electron Stop after Qwen CPU load: child processes exited.
- Native Electron window close after Qwen GPU load: child processes exited.
- Regression tests: stop while waiting, capture failure propagation, stop-file
  handling, server startup timeout cleanup and unstarted capture-thread cleanup.

Process disappearance establishes that the model worker no longer owns memory;
total GPU memory can remain occupied by other applications. Windows may briefly
retain a terminating process while it releases resources, so the native tests
allow up to five seconds after the exit event when checking descendant PIDs.
This pass did not open microphone/system capture devices or test a real meeting.
Stopping can omit queued/partial captions; forced termination can interrupt
output writing. Full transcription of the saved recording remains separate.

Reproducible test commands are in `electron_app/README.md`. Local raw evidence:
`outputs/ui-review/backend-latency.json`, `outputs/backend-review/replay.log`,
and `outputs/backend-review/native/qwen-events.json` (all ignored by Git).
