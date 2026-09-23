# Japanese local ASR benchmark

Compare CUDA faster-whisper small / large-v3-turbo and Qwen3-ASR 0.6B / 1.7B
on the same pinned Japanese audio. This is a pilot for low-latency captions;
it does not change the desktop app's default backend.

## Run on Windows with an NVIDIA GPU

From the repository root, using PowerShell and `uv`:

```powershell
$env:PYTHONUTF8 = '1'
uv sync --project benchmarks --locked
uv run --project benchmarks python benchmarks/prepare.py
uv run --project benchmarks python -m unittest discover -s benchmarks -p test_metrics.py -v
uv run --project benchmarks python benchmarks/run.py
uv run --project benchmarks python benchmarks/replay_prefix.py
uv run --project benchmarks python benchmarks/report.py
```

Preparation downloads several GB of models, and streams the beginning of the
FLEURS test archive until 12 unique sentence IDs have been found. It never records
your microphone, plays audio, or uploads recordings. The inference workers only
load local model files. The dedicated `benchmarks/.venv` does not replace existing
backend environments. GPU execution is required; there is no silent CPU fallback.

## What is measured

- Twelve full utterances: normalized character error rate (CER), warm inference
  time including preprocessing and decoding, and real-time factor (RTF).
- The same first four utterances in independent 3-second chunks: CER, first
  nonempty caption, chunk-end delay and accumulated single-worker backlog.
  By default arrival time is **simulated** from actual synchronous inference
  times. Use `run.py --realtime --output outputs/asr_benchmark/paced-results`
  for wall-clock paced replay without overwriting the initial results.
- `replay_prefix.py`: actual wall-clock paced replay, one-second updates with
  cumulative context. Captions are revisable; only the final text is scored.
  Utterance boundaries are supplied by the dataset, not a tested VAD system.
- Three seconds of digital silence, and cold inference recorded separately.
- Sampled total GPU memory (includes desktop/other programs); PyTorch peak
  allocation is also recorded for Qwen, but does not measure CTranslate2 memory.

Whisper uses FP16, greedy decoding and VAD; Qwen uses BF16/SDPA with a 256-token
limit and errors on truncation. All use batch size 1 and forced Japanese.
Whisper here uses CTranslate2/CUDA; desktop timings depend on the backend selected
in the app and cannot be inferred from these results. Qwen uses Transformers, **not** its native streaming vLLM backend or
`torch.compile`. The run compares deployable pipelines, not matched architectures.

CER normalization applies NFKC and lowercase, removes punctuation, whitespace
and controls, and preserves numeral spelling. Errors are aggregated by character
count (not averaged per sentence); empty references are not assigned a fake CER.

## Evidence and limitations

Models are pinned by repository revision in `prepare.py`; Python dependencies
are locked. The data manifest stores the dataset revision, IDs, human reference
text and SHA-256 of every WAV. Audio hashes are checked before inference.
Each model runs in a fresh subprocess and the GPU workloads run sequentially.
Results are checkpointed to JSON after each utterance so failures are visible.

Local models: `models/benchmark/`. Local audio and raw results:
`outputs/asr_benchmark/`. Both locations are ignored by Git. Published reports
are under `docs/asr-benchmark/` and include raw result JSON and checksums.

This small sample is **clean read speech, not meeting audio**. It cannot establish
accuracy on interruptions, overlapping speakers, noise, or business vocabulary.
Three-second chunks are not native streaming. One-second prefix replay does not
measure stable-word latency or prove production endpoint detection. The prefix
experiment uses the same pilot subset and is not an independent held-out test.
Hardware capture, Electron rendering and long-meeting stability remain separate
validation steps. No audio is captured from your actual meeting by these scripts.

Dataset: [Google FLEURS](https://huggingface.co/datasets/google/fleurs), CC-BY-4.0.

Results: [2026-09-22 Traditional Chinese report](../docs/asr-benchmark/2026-09-22/REPORT.zh-TW.md).

## Nemotron 3.5 ASR 0.6B native streaming

The separate experiment keeps the original four-model results intact. Download
the pinned Transformers checkpoint, then run each configuration sequentially:

```powershell
uv run --project benchmarks python benchmarks/prepare_nemotron.py
uv run --project benchmarks python -m unittest discover -s benchmarks -p 'test_*.py' -v
uv run --project benchmarks python benchmarks/run_nemotron.py --chunk-ms 320
uv run --project benchmarks python benchmarks/run_nemotron.py --chunk-ms 80
uv run --project benchmarks python benchmarks/report_nemotron.py
```

Run `prepare.py --audio-only` first if this is a fresh checkout. The report also
uses the committed Turbo results as its baseline. This test uses CUDA FP32,
native encoder/decoder caches and wall-clock paced PCM, with a zero-padded final
chunk. It measures 12 full utterances and replays the same first four in real time.
Inference is offline; preparation downloads weights into `models/benchmark/`.

The model card advertises 160 ms, but the pinned Transformers checkpoint rejects
that setting: supported chunk sizes are 80, 320, 560 and 1120 ms. The runner
validates this instead of overriding model configuration. Chunk size is not
end-to-end caption latency. File boundaries are known and no capture/UI path is
tested. Signal-boundary tests require the downloaded processor files, but run on CPU.

Results: [Nemotron report](../docs/asr-benchmark/2026-09-22-nemotron/REPORT.zh-TW.md).

## App Whisper live-caption replay

The app's CUDA whisper.cpp server can replay the same four public Japanese files
through both the former fixed 3-second chunks and the current VAD utterance flow.
It does not open audio devices. Use `--realtime` to pace the VAD replay by audio
arrival time and measure update lag; fixed chunks remain a virtual replay.

```powershell
uv run --with huggingface-hub python python_backend/download_assets.py --only whisper-cpp-turbo-model
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with faster-whisper python benchmarks/replay_live_cpp.py --model turbo --count 4 --gain 1 --realtime
uv run --with soundcard --with soundfile --with numpy --with soxr --with requests --with psutil --with faster-whisper python test/backend_replay.py --turbo
```

The downloader pins and hash-checks the Turbo ggml model. The lifecycle replay
uses a simulated capture device, verifies preview/final events and a valid WAV,
then confirms that the CUDA server exits. Results and limits:
[Whisper live replay report](../docs/asr-benchmark/2026-09-23-live-whisper/REPORT.zh-TW.md).
