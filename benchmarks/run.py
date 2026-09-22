"""Compare local ASR accuracy and chunked replay latency, in isolated processes.

Replay is fixed-window transcription, NOT native streaming. Without --realtime,
audio arrivals are simulated from measured synchronous inference times. No audio
is uploaded. Download models/data with prepare.py before running this script.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import threading
import time
import traceback

from metrics import replay_timing, score
from prepare import DATA, MODELS, ROOT

RESULTS = ROOT / "outputs" / "asr_benchmark" / "results"
DLL_HANDLES = []


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lo = int(position)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


class DeviceMemory:
    """Total device memory, including other apps; not per-model allocation."""
    def __init__(self):
        self.stop = threading.Event()
        self.values = []
        self.thread = threading.Thread(target=self.monitor, daemon=True)

    def monitor(self):
        while not self.stop.is_set():
            try:
                result = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits", "-i", "0"],
                    capture_output=True, text=True, timeout=5,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                self.values.append(int(result.stdout.strip()))
            except (OSError, ValueError, subprocess.TimeoutExpired):
                pass
            self.stop.wait(0.5)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=6)


class Engine:
    def __init__(self, key: str):
        import torch

        self.torch = torch
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable; refusing a silent CPU fallback")
        torch.set_num_threads(8)
        torch.manual_seed(0)
        self.key = key
        folder = ROOT / "models" / "benchmark" / key
        if not folder.exists():
            raise FileNotFoundError(f"Run prepare.py first: {folder}")
        if key.startswith("whisper"):
            # CTranslate2 needs CUDA/cuDNN DLLs; reuse the pinned PyTorch runtime.
            dll_dir = Path(torch.__file__).parent / "lib"
            if os.name == "nt":
                DLL_HANDLES.append(os.add_dll_directory(str(dll_dir)))
                os.environ["PATH"] = str(dll_dir) + os.pathsep + os.environ.get("PATH", "")
            from faster_whisper import WhisperModel

            self.model = WhisperModel(str(folder), device="cuda", compute_type="float16", cpu_threads=8)
        else:
            from transformers import AutoModelForMultimodalLM, AutoProcessor

            self.processor = AutoProcessor.from_pretrained(folder, local_files_only=True)
            self.model = AutoModelForMultimodalLM.from_pretrained(
                folder, dtype=torch.bfloat16, local_files_only=True, attn_implementation="sdpa"
            ).to("cuda").eval()

    def transcribe(self, audio) -> str:
        if self.key.startswith("whisper"):
            segments, _ = self.model.transcribe(
                audio, language="ja", beam_size=1, temperature=0,
                condition_on_previous_text=False, vad_filter=True,
            )
            # faster-whisper is lazy: consume every segment inside the timer.
            return "".join(s.text.strip() for s in segments)
        inputs = self.processor.apply_transcription_request(audio=audio, language="Japanese")
        inputs = inputs.to("cuda", self.torch.bfloat16)
        with self.torch.inference_mode():
            result = self.model.generate(**inputs, max_new_tokens=256, do_sample=False)
        generated = result[0, inputs["input_ids"].shape[1]:]
        if len(generated) >= 256:
            raise RuntimeError("Generation hit the token limit; benchmark would be truncated")
        return self.processor.decode(generated, return_format="transcription_only").strip()

    def timed(self, audio) -> tuple[str, float]:
        self.torch.cuda.synchronize()
        started = time.perf_counter()
        text = self.transcribe(audio)
        self.torch.cuda.synchronize()
        return text, time.perf_counter() - started


def summarize(rows: list[dict], chunked: list[dict]) -> dict:
    errors = sum(row["errors"] for row in rows)
    chars = sum(row["reference_chars"] for row in rows)
    inference = sum(row["inference_seconds"] for row in rows)
    duration = sum(row["audio_seconds"] for row in rows)
    chunks = [chunk for row in chunked for chunk in row["chunks"]]
    replay_errors = sum(row["errors"] for row in chunked)
    replay_chars = sum(row["reference_chars"] for row in chunked)
    return {
        "utterance_cer": errors / chars if chars else None,
        "utterance_audio_seconds": duration, "utterance_inference_seconds": inference,
        "utterance_rtf": inference / duration if duration else None,
        "utterance_inference_median_seconds": statistics.median(row["inference_seconds"] for row in rows),
        "chunked_cer": replay_errors / replay_chars if replay_chars else None,
        "chunk_inference_p50_seconds": statistics.median(c["inference_seconds"] for c in chunks) if chunks else None,
        "chunk_inference_p95_seconds": percentile([c["inference_seconds"] for c in chunks], .95) if chunks else None,
        "chunk_end_lag_p95_seconds": percentile([c["lag_seconds"] for c in chunks], .95) if chunks else None,
        "max_queue_seconds": max((c["queue_seconds"] for c in chunks), default=0),
        "first_caption_p50_seconds": statistics.median(r["first_caption_seconds"] for r in chunked if r["first_caption_seconds"] is not None) if any(r["first_caption_seconds"] is not None for r in chunked) else None,
        "final_caption_lag_p50_seconds": statistics.median(r["final_caption_lag_seconds"] for r in chunked) if chunked else None,
    }


def run_worker(args) -> None:
    import numpy as np
    import soundfile as sf
    import torch

    manifest_path = DATA / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    samples = []
    for item in manifest["samples"]:
        path = DATA / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Audio checksum mismatch: {path}")
        audio, rate = sf.read(path, dtype="float32")
        if rate != 16000 or audio.ndim != 1:
            raise ValueError(f"Expected mono 16 kHz audio: {path}")
        samples.append((item, audio))
    result = {
        "status": "running", "model": args.worker, "model_source": MODELS[args.worker],
        "utc": datetime.now(timezone.utc).isoformat(), "platform": platform.platform(),
        "gpu": torch.cuda.get_device_name(0), "torch_cuda": torch.version.cuda,
        "packages": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "faster-whisper", "ctranslate2", "numpy"]},
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "lock_sha256": hashlib.sha256((ROOT / "benchmarks" / "uv.lock").read_bytes()).hexdigest(),
        "protocol": {
            "language": "Japanese", "batch_size": 1, "beam_size": 1,
            "chunk_seconds": args.chunk_seconds, "replay_samples": args.replay_samples,
            "replay_mode": "wall-clock paced" if args.realtime else "virtual arrivals from measured inference",
            "streaming": "independent fixed chunks; no lookahead/overlap, no native model streaming",
            "normalization": "NFKC + lowercase, remove whitespace/punctuation/control; preserve number spelling",
            "whisper": "FP16, VAD enabled, no previous text; Qwen BF16/SDPA, no compile",
            "limitations": "Small clean read-speech subset; no meeting, WASAPI, UI, or word-aligned latency validation",
        },
        "utterances": [], "replays": [],
    }
    target = Path(args.output) / f"{args.worker}.json"
    write_json(target, result)
    with DeviceMemory() as memory:
        started = time.perf_counter()
        engine = Engine(args.worker)
        torch.cuda.synchronize()
        result["load_seconds"] = time.perf_counter() - started
        text, seconds = engine.timed(samples[0][1][:48000])
        result["cold_first_3s"] = {"text": text, "inference_seconds": seconds}
        torch.cuda.reset_peak_memory_stats()
        for item, audio in samples:
            text, seconds = engine.timed(audio)
            result["utterances"].append({
                "id": item["id"], "file": item["file"], "reference": item["reference"],
                "text": text, "audio_seconds": len(audio) / 16000,
                "inference_seconds": seconds, **score(item["reference"], text),
            })
            print(f"{args.worker} utterance {len(result['utterances'])}/{len(samples)}: {seconds:.3f}s", flush=True)
            write_json(target, result)
        frames = round(args.chunk_seconds * 16000)
        for item, audio in samples[:args.replay_samples]:
            chunks = []
            previous_finish = 0.0
            first_caption = None
            replay_start = time.perf_counter()
            for start in range(0, len(audio), frames):
                end = min(start + frames, len(audio))
                audio_end = end / 16000
                if args.realtime:
                    time.sleep(max(0, audio_end - (time.perf_counter() - replay_start)))
                    actual_start = time.perf_counter() - replay_start
                text, seconds = engine.timed(audio[start:end])
                timing = replay_timing(previous_finish, audio_end, seconds)
                if args.realtime:
                    finish = time.perf_counter() - replay_start
                    timing = {"start": actual_start, "finish": finish, "queue_seconds": max(0, actual_start - audio_end), "lag_seconds": finish - audio_end}
                previous_finish = timing["finish"]
                if text and first_caption is None:
                    first_caption = previous_finish
                chunks.append({"audio_start": start / 16000, "audio_end": audio_end, "text": text, "inference_seconds": seconds, **timing})
            hypothesis = "".join(chunk["text"] for chunk in chunks)
            result["replays"].append({
                "id": item["id"], "file": item["file"], "reference": item["reference"],
                "text": hypothesis, "chunks": chunks, "first_caption_seconds": first_caption,
                "final_caption_lag_seconds": previous_finish - len(audio) / 16000,
                **score(item["reference"], hypothesis),
            })
            print(f"{args.worker} replay {len(result['replays'])}/{args.replay_samples}: final lag {previous_finish - len(audio)/16000:.3f}s", flush=True)
            write_json(target, result)
        silence_text, silence_seconds = engine.timed(np.zeros(48000, dtype=np.float32))
        result["silence_3s"] = {"text": silence_text, "inference_seconds": silence_seconds}
        result["torch_peak_allocated_mib"] = torch.cuda.max_memory_allocated() / 1024**2 if args.worker.startswith("qwen") else None
    result["device_memory_mib"] = {
        "first_sample": memory.values[0] if memory.values else None,
        "sampled_peak": max(memory.values) if memory.values else None,
        "scope": "whole GPU including desktop and other apps; sampled every 0.5s",
    }
    result["summary"] = summarize(result["utterances"], result["replays"])
    result["status"] = "complete"
    write_json(target, result)
    print(json.dumps(result["summary"]), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", choices=MODELS, default=list(MODELS))
    parser.add_argument("--worker", choices=MODELS)
    parser.add_argument("--chunk-seconds", type=float, default=3)
    parser.add_argument("--replay-samples", type=int, default=4)
    parser.add_argument("--realtime", action="store_true")
    parser.add_argument("--output", type=Path, default=RESULTS)
    args = parser.parse_args()
    if args.chunk_seconds <= 0 or args.replay_samples < 0:
        parser.error("chunk-seconds must be positive; replay-samples must be nonnegative")
    if args.worker:
        try:
            run_worker(args)
        except Exception:
            target = args.output / f"{args.worker}.json"
            data = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {"model": args.worker}
            data.update(status="failed", error=traceback.format_exc())
            write_json(target, data)
            raise
        return
    failures = []
    for key in args.models:
        command = [sys.executable, str(Path(__file__).resolve()), "--worker", key,
                   "--chunk-seconds", str(args.chunk_seconds), "--replay-samples", str(args.replay_samples),
                   "--output", str(args.output.resolve())]
        if args.realtime:
            command.append("--realtime")
        completed = subprocess.run(command, env={**os.environ, "PYTHONUTF8": "1", "HF_HUB_OFFLINE": "1"})
        if completed.returncode:
            failures.append(key)
    if failures:
        raise SystemExit("Failed models (see JSON errors): " + ", ".join(failures))


if __name__ == "__main__":
    main()
