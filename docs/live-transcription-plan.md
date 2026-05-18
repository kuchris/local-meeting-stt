# Live Transcription Strategy & Implementation Plan

Design notes for the whisper.cpp CPU live path on a Windows Electron meeting-transcription app.
Target hardware: **Intel Core Ultra 7 155U** (12 cores / 14 threads — 2 P-cores+HT, 8 E-cores, 2 LP-E-cores; ~15 W; Intel Arc iGPU; NPU).

---

## 1. Problem

Live mode drops chunks and pins the CPU:

```
Warning: transcription is behind; dropped one queued audio chunk.
```

### Root cause — it's the architecture, not the model

In order of impact:

1. **The CPU live path reloads the model every chunk.** `live_cpp.py` spawns a fresh
   `whisper-cli.exe` per 3s chunk. Each process loads the ~466 MB `ggml-small.bin`
   from disk, initializes, transcribes 3s, exits. The model load alone costs
   ~0.5–1.5s *per chunk*, repeated ~20×/minute. This is the dominant inefficiency.
2. **`--threads 16` on a 14-thread CPU.** `live_cpp_cpu.cmd` oversubscribes the
   thread pool. whisper.cpp scales well only across the fast cores; piling work
   onto slow E-cores and over-subscribing adds context-switch overhead and can be
   *slower* while still pinning CPU to 100%.
3. **No VAD on the whisper.cpp path.** Meetings are mostly silence/pauses, but every
   chunk is transcribed anyway. (The faster-whisper path already uses `vad_filter=True`.)

The 3s chunk + `small` model is survivable on its own; it only falls behind because
each chunk *also* pays a model-reload tax and fights an oversubscribed thread pool.

---

## 2. Comparison of the levers

### Model (CPU real-time factor on a 15 W U-series chip, rough)

| Model | Size   | RTF (lower = faster) | Japanese accuracy        | Verdict                  |
|-------|--------|----------------------|--------------------------|--------------------------|
| tiny  | 75 MB  | ~0.1–0.2×            | weak                     | too inaccurate for JA    |
| base  | 142 MB | ~0.25–0.4×           | usable for a live draft  | **best live choice**     |
| small | 466 MB | ~0.7–1.5×            | good                     | marginal live, great post|

`base` gives ~3–4× headroom over real-time, so a 3s chunk transcribes in ~1s and the
queue stays empty. `small` sits near 1.0× — one dense passage and you fall behind.

### Chunk length — latency vs. overhead vs. boundary errors

- Shorter (2–3s): lower latency, more per-call overhead, more words sliced at cuts.
- Longer (5–8s): fewer boundary cuts, better accuracy, higher latency to first text.
- With model reload eliminated, **4–5s** is the sweet spot for live.

### Thread count

- whisper.cpp peaks at **4–6 threads** on this chip. Past the P-cores returns drop off fast.
- `16` is actively counterproductive.
- Use **4** for live (leaves cores for capture + Electron), **8–10** for post.

### Queue behavior

- `--max-backlog 24` = 24 × 3s = **72s** of audio can pile up before a drop.
  That is a minute stale, *then* you lose words.
- Use a backlog of **2–3**: if you can't keep up you find out immediately, and the
  fix is a smaller model, not a deeper queue.
- Dropping a chunk always loses words mid-sentence — the queue should be short
  enough that drops are rare *and* visible.

### VAD / no-speech

- Biggest free CPU win. In a real meeting 40–60% is silence/pauses.
- Skipping silent chunks roughly halves CPU load **and** prevents whisper from
  hallucinating text on silence.

---

## 3. The whisper.cpp resident-model problem

Two dead ends were found while trying to keep the model resident:

- **`whisper-stream.exe`** keeps the model resident — but uses SDL capture devices,
  not SoundCard loopback. On this PC it only sees the laptop mic, so it cannot
  capture Teams/browser speaker audio.
- **`whisper-cli.exe`** captures fine (via SoundCard) — but reloads the model every chunk.

### Working manual test — `whisper-server.exe`

```
whisper-server.exe -m whisper_cpp/models/ggml-small.bin -l ja -t 6 -ng --host 127.0.0.1 --port 18080 -nt
curl -X POST http://127.0.0.1:18080/inference -F "file=@test/audio.wav" -F "temperature=0" -F "response-format=json"
```

Returns valid transcript JSON.

### Chosen architecture

```
SoundCard speaker loopback  ->  in-memory chunk WAV  ->  POST /inference (resident whisper-server)  ->  append to live_transcript.txt
                            \-> full audio.wav saved in session folder
```

This decouples **capture** (SoundCard — the part that works) from **inference**
(a process that loads the model once and stays warm). It is the correct fix.

---

## 4. Q&A

### Q1 — Is whisper-server the right architecture?

Yes. It is the standard pattern for "resident whisper.cpp model + SoundCard loopback
capture." The only real competitor is faster-whisper in-process (see Q5).

### Q2 — Risks of POSTing 3–5s chunks repeatedly

- **The bottleneck moves, it doesn't vanish.** whisper-server has one model context
  and processes `/inference` **serially**. POST faster than it transcribes and
  requests queue *inside the server* where you can't see or drop them. Enforce
  **one request in flight** on the client and drop chunks yourself when behind.
- **Silence hallucinations.** `small` at `temperature=0` on a near-silent chunk
  reliably emits Japanese stock phrases (`ご視聴ありがとうございました`, etc.).
  Without a speech gate the live transcript fills with garbage during pauses.
- **Chunk-boundary splitting.** Independent chunks share no context; words at the
  cut get mangled. Acceptable for a live draft. Don't add overlap — it duplicates words.
- **Temp-file churn.** Avoidable — POST the bytes in memory instead of a temp WAV.
- **Startup race.** The model takes seconds to load; POSTs before "listening" fail.
- **Orphaned server** if the parent dies ungracefully.

### Q3 — Server lifecycle

- **Port:** open a socket on `127.0.0.1:0`, read the assigned port, close it, pass
  it to `--port`. Always bind `--host 127.0.0.1` (never expose it).
- **Readiness:** read whisper-server stdout until the "listening" line, *or* poll
  with a connect + cheap request and backoff. Start capture only after ready.
- **Stop:** kill the process tree (`taskkill /pid <pid> /t /f` — already used in
  `main.ts`). Also kill the server in Python's `finally` for clean Ctrl+C / crash.

### Q4 — Python or Electron control?

**Put the server under Python (`live_cpp.py`), not Electron.**

- `live_cpp.py` is already the live-session process Electron spawns and already gets
  its whole process tree killed on Stop. Make whisper-server a *child* of
  `live_cpp.py` and orphan-handling is free.
- Port selection, readiness wait, single-flight and drop logic all live next to the
  capture loop — one file owns the concern.
- `main.ts` stays a thin launcher: no second process to track, no port over IPC.

### Q5 — Better alternatives

Two genuinely good options; pick by whether you're committed to the whisper.cpp *engine*:

- **whisper-server subprocess** — right choice if you want whisper.cpp specifically
  (parity with a whisper.cpp post path, quantized ggml models).
- **faster-whisper in-process** — `live_transcribe.py` already does this: model
  resident *in the same Python process*, VAD built in, no HTTP, no temp files, no
  second process, no port, no readiness race. Strictly less machinery. If not
  attached to the whisper.cpp engine, this is the simpler default.
- Middle ground: `pywhispercpp` keeps a whisper.cpp model resident in-process —
  whisper.cpp engine, no HTTP — but adds a build/dependency.

### Q6 — Recommended settings for Core Ultra 7 155U

| Setting        | Recommend            | Note |
|----------------|----------------------|------|
| Model (live)   | `ggml-base.bin`      | `small` is marginal *even resident* — the server fixes the reload tax, not raw compute. Keep `small`/Qwen for post. |
| Threads        | `-t 6`               | 4–6 is the realistic peak. Don't exceed 6. Test 4 vs 6. |
| Chunk seconds  | 4–5s                 | Good latency/accuracy balance with the model resident. |
| Backlog        | 2–3 chunks           | One POST in flight; drop oldest when a new chunk is ready and the previous POST hasn't returned. |
| VAD/no-speech  | Energy gate before POST | RMS per chunk; below threshold, skip the POST. Saves CPU on every pause and prevents silence hallucinations. Optionally upgrade to `webrtcvad`. |
| Language       | `-l ja -nt`, `temperature=0`, greedy | No timestamps for live. |

---

## 5. Recommended split

| Mode | Model | Threads | Chunk | Queue | Notes |
|------|-------|---------|-------|-------|-------|
| **Live** | `base` (resident) | 4–6 | 4–5s | 2–3 | VAD/energy gate on, model loaded once |
| **Post** | `small` / Qwen | 8–10 | large (60s ok) | n/a | run on the saved `audio.wav`, accuracy over latency |

Live just needs to be "good enough to follow along." The saved WAV is the source of
truth — always run post-transcription on it, so the rough live draft and the accurate
final never compete for CPU.

---

## 6. Implementation plan (inside `live_cpp.py`)

1. **Port + spawn** → verify: server PID is a child of `live_cpp.py`.
   Grab a free `127.0.0.1` port, spawn
   `whisper-server.exe -m ggml-base.bin -l ja -t 6 -ng -nt --host 127.0.0.1 --port <p>`.
2. **Readiness wait** → verify: a probe `/inference` (or stdout "listening") succeeds
   before capture starts.
3. **Capture loop** (unchanged SoundCard logic) → verify: full-session `audio.wav`
   still saved in the session folder.
4. **Per-chunk gate** → verify: a silent chunk produces no POST and no transcript line.
   RMS check; if speech present, encode the chunk WAV in memory (`io.BytesIO`) and
   POST as a multipart file — no temp file on disk.
5. **Single-flight + drop** → verify: under load, chunks are dropped client-side and
   latency stays near real-time (no server-side pileup).
6. **Append result** → verify: JSON parsed as UTF-8, text appended to `live_transcript.txt`.
7. **Teardown** (`finally` + `atexit`) → verify: server process gone after normal
   stop, Ctrl+C, and Electron Stop.

`main.ts` change: point the `live-cpp-cpu` case at this path (or a new `.cmd`);
no server logic in Electron.

---

## 7. Hidden problems

1. **`small` is still marginal even resident** — the server kills the reload tax, not
   compute. Plan on `base` for live.
2. **Server queues internally** — POSTing concurrently doesn't parallelize anything
   (one model context); it just hides the backlog. Enforce single-flight client-side.
3. **Silence hallucinations in Japanese** — without the energy/VAD gate every pause
   emits stock phrases. Not optional.
4. **Readiness race** — model load takes seconds; capture must not POST until the
   server is confirmed up.
5. **Orphaned server** — only safe if it's a child of `live_cpp.py` *and* Python kills
   it in `finally`. Don't spawn it detached.
6. **Connection/timeout tuning** — set the HTTP timeout longer than worst-case
   inference, and reuse a keep-alive connection (`requests.Session`).
7. **Two whisper.cpp servers** — if post-transcription ever uses a server too, keep
   them separate/ephemeral per session to avoid lock contention. Easiest: the live
   server lives and dies with the live session only.

---

## 8. Optional bigger lever

The 155U has an Intel Arc iGPU and an NPU, both idle (the `bin_cuda` build is
NVIDIA-only, useless here). whisper.cpp has a **Vulkan backend** that runs on the Arc
iGPU, and OpenVINO support that can use the NPU. Either moves inference off the CPU
entirely and would let `small` run live with low CPU. That's a build/packaging
change, not a settings tweak — worth it if the `base` plan still leaves CPU higher
than desired.
