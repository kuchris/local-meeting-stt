"""Local Nemotron: full utterances and genuinely cached, wall-clock streaming.

Only arrived PCM is featurized. EOF is known (dataset boundaries), and the final
chunk is zero-padded instead of discarded. No microphone, cloud API or UI.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import statistics
import time
import traceback

os.environ["HF_HUB_OFFLINE"] = "1"

from metrics import score
from prepare import DATA, ROOT
from prepare_nemotron import MODEL_DIR, MODEL_ID, REVISION
from run import DeviceMemory, percentile, write_json


def chunk_plan(length, first_frames, subsequent_frames, hop=160, n_fft=512):
    """Exact STFT windows; include a partial final chunk and startup left pad."""
    total_frames = max(1, length // hop)
    frame = 0
    while frame < total_frames:
        first = frame == 0
        frames = first_frames if first else subsequent_frames
        start = 0 if first else frame * hop - n_fft // 2
        end = (frame + frames - 1) * hop + n_fft // 2
        yield {"frame": frame, "frames": frames, "start": start, "end": end,
               "first": first, "available_samples": min(end, length)}
        frame += frames


class Nemotron:
    def __init__(self, chunk_ms, dtype):
        import torch
        from transformers import AutoModelForRNNT, AutoProcessor

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA required; no CPU fallback")
        self.torch = torch
        torch.set_num_threads(8)
        torch.manual_seed(0)
        self.processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
        self.supported = self.processor.supported_streaming_latencies_ms
        right = next((r for r, ms in self.supported.items() if ms == chunk_ms), None)
        if right is None:
            raise ValueError(f"Pinned checkpoint supports {self.supported}, not {chunk_ms} ms")
        self.right = right
        self.processor.set_num_lookahead_tokens(right)
        self.model = AutoModelForRNNT.from_pretrained(
            MODEL_DIR, local_files_only=True, dtype=getattr(torch, dtype),
        ).to("cuda").eval()

    def features(self, audio, plan):
        import numpy as np

        part = audio[max(0, plan["start"]):min(len(audio), plan["end"])]
        part = np.pad(part, (max(0, -plan["start"]), max(0, plan["end"] - len(audio))))
        inputs = self.processor(
            part, sampling_rate=16000, language="ja-JP", is_streaming=True,
            is_first_audio_chunk=plan["first"], return_tensors="pt",
        ).to(self.model.device, self.model.dtype)
        features = inputs.input_features[:, :plan["frames"], :]
        if features.shape[1] != plan["frames"]:
            raise ValueError(f"Invalid feature shape {features.shape}: {plan}")
        return features

    def offline(self, audio):
        self.torch.cuda.synchronize()
        started = time.perf_counter()
        inputs = self.processor(audio, sampling_rate=16000, language="ja-JP").to("cuda", self.model.dtype)
        with self.torch.inference_mode():
            output = self.model.generate(**inputs)
        text = self.processor.decode(output.sequences[0], skip_special_tokens=True).strip()
        self.torch.cuda.synchronize()
        return text, time.perf_counter() - started

    def stream(self, audio, paced=True):
        engine = self
        chunks, updates, ids = [], [], []
        previous_text = ""
        started = time.perf_counter()

        class CaptionStream:
            def put(self, values):
                nonlocal previous_text
                ids.extend(values.reshape(-1).tolist())
                text = engine.processor.decode(ids, skip_special_tokens=True).strip()
                if text != previous_text:
                    updates.append({"text": text, "emitted_at": time.perf_counter() - started,
                                    "audio_available": chunks[-1]["audio_end"] if chunks else 0})
                    previous_text = text

            def end(self):
                pass

        def features_generator():
            for plan in chunk_plan(len(audio), self.processor.num_mel_frames_first_audio_chunk,
                                   self.processor.num_mel_frames_per_audio_chunk):
                arrival = plan["available_samples"] / 16000
                if paced:
                    time.sleep(max(0, arrival - (time.perf_counter() - started)))
                self.torch.cuda.synchronize()
                begin = time.perf_counter()
                row = {**plan, "audio_end": arrival,
                       "queue_seconds": max(0, begin - started - arrival) if paced else None}
                chunks.append(row)
                yield self.features(audio, plan)
                self.torch.cuda.synchronize()
                row.update(processing_seconds=time.perf_counter() - begin,
                           finished_at=time.perf_counter() - started)
                row["lag_seconds"] = row["finished_at"] - arrival if paced else None

        # Explicit generous cap includes RNNT blank steps, and is checked below.
        max_steps = (math.ceil(len(audio) / 1280) + 32) * 12
        with self.torch.inference_mode():
            output = self.model.generate(
                input_features=features_generator(), num_lookahead_tokens=self.right,
                prompt_ids=self.torch.tensor([10], device="cuda"),
                streamer=CaptionStream(), max_new_tokens=max_steps, do_sample=False,
            )
        self.torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        if output.sequences.shape[1] - 1 >= max_steps:
            raise RuntimeError("RNNT hit generation cap; refusing truncated result")
        text = self.processor.decode(output.sequences[0], skip_special_tokens=True).strip()
        if text != previous_text:
            raise RuntimeError("Streamed captions differ from returned transcript")
        if not all("finished_at" in c for c in chunks):
            raise RuntimeError("Stream ended before consuming its final chunk")
        return {"text": text, "audio_seconds": len(audio) / 16000, "elapsed_seconds": elapsed,
                "chunks": chunks, "updates": updates,
                "first_caption_seconds": next((u["emitted_at"] for u in updates if u["text"]), None),
                "final_caption_lag_seconds": elapsed - len(audio) / 16000 if paced else None}


def execute(args, result, target):
    import numpy as np
    import soundfile as sf
    import torch

    manifest_bytes = (DATA / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    samples = []
    for item in manifest["samples"]:
        path = DATA / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Checksum mismatch: {path}")
        audio, rate = sf.read(path, dtype="float32")
        if rate != 16000 or audio.ndim != 1:
            raise ValueError("Expected mono 16 kHz")
        samples.append((item, audio))
    result.update(
        model=MODEL_ID, revision=REVISION, utc=datetime.now(timezone.utc).isoformat(),
        gpu=torch.cuda.get_device_name(0), platform=platform.platform(),
        packages={k: importlib.metadata.version(k) for k in ("torch", "transformers", "numpy")},
        manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
        lock_sha256=hashlib.sha256((ROOT / "benchmarks" / "uv.lock").read_bytes()).hexdigest(),
        protocol={"language": "ja-JP", "dtype": args.dtype, "chunk_ms": args.chunk_ms,
                  "batch_size": 1, "decoding": "greedy RNNT; no compile; no external VAD",
                  "streaming": "native encoder/decoder cache; paced raw PCM; final zero-padded chunk",
                  "boundaries": "oracle file EOF, not production VAD",
                  "latency": "from WAV start including silence; chunk completion lag, not aligned word latency",
                  "limitations": "12 clean read-speech utterances; no meeting/microphone/WASAPI/Electron validation"},
        utterances=[], replays=[],
    )
    with DeviceMemory() as memory:
        started = time.perf_counter()
        engine = Nemotron(args.chunk_ms, args.dtype)
        torch.cuda.synchronize()
        result["load_seconds"] = time.perf_counter() - started
        result["supported_chunk_ms"] = engine.supported
        result["parameters"] = sum(p.numel() for p in engine.model.parameters())
        text, seconds = engine.offline(samples[0][1][:48000])
        result["cold_first_3s"] = {"text": text, "inference_seconds": seconds}
        result["stream_warmup_seconds"] = engine.stream(samples[0][1][:48000], paced=False)["elapsed_seconds"]
        torch.cuda.reset_peak_memory_stats()
        write_json(target, result)
        for item, audio in samples[:args.count]:
            text, seconds = engine.offline(audio)
            result["utterances"].append({**item, "text": text, "audio_seconds": len(audio) / 16000,
                                         "inference_seconds": seconds, **score(item["reference"], text)})
            print(f"Offline {len(result['utterances'])}/{args.count}: {seconds:.3f}s {text}", flush=True)
            write_json(target, result)
        for item, audio in samples[:args.replay_count]:
            row = engine.stream(audio)
            row.update(id=item["id"], reference=item["reference"], **score(item["reference"], row["text"]))
            result["replays"].append(row)
            print(f"Stream {len(result['replays'])}/{args.replay_count}: first={row['first_caption_seconds']} {row['text']}", flush=True)
            write_json(target, result)
        result["silence_3s"] = engine.stream(np.zeros(48000, dtype=np.float32), paced=False)["text"]
        result["torch_peak_allocated_mib"] = torch.cuda.max_memory_allocated() / 1024**2
    result["device_memory_mib"] = {"first_sample": memory.values[0], "sampled_peak": max(memory.values),
                                   "scope": "whole GPU including other programs, sampled every 0.5s"} if memory.values else None
    rows, replays = result["utterances"], result["replays"]
    chunks = [c for r in replays for c in r["chunks"]]
    result["summary"] = {
        "utterance_cer": sum(r["errors"] for r in rows) / sum(r["reference_chars"] for r in rows),
        "utterance_inference_seconds": sum(r["inference_seconds"] for r in rows),
        "utterance_rtf": sum(r["inference_seconds"] for r in rows) / sum(r["audio_seconds"] for r in rows),
        "streaming_cer": sum(r["errors"] for r in replays) / sum(r["reference_chars"] for r in replays),
        "first_caption_p50_seconds": statistics.median(r["first_caption_seconds"] for r in replays if r["first_caption_seconds"] is not None),
        "chunk_lag_p95_seconds": percentile([c["lag_seconds"] for c in chunks], .95),
        "chunk_processing_p95_seconds": percentile([c["processing_seconds"] for c in chunks], .95),
        "max_queue_seconds": max(c["queue_seconds"] for c in chunks),
    }
    result["status"] = "complete"
    write_json(target, result)
    print(json.dumps(result["summary"]), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunk-ms", type=int, default=320)
    parser.add_argument("--dtype", choices=["float32", "bfloat16"], default="float32")
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--replay-count", type=int, default=4)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not (1 <= args.count <= 12 and 1 <= args.replay_count <= 12):
        parser.error("counts must be between 1 and 12")
    target = args.output or DATA.parent / "nemotron" / f"{args.chunk_ms}ms-{args.dtype}.json"
    result = {"status": "running"}
    try:
        execute(args, result, target)
    except Exception:
        result.update(status="failed", error=traceback.format_exc())
        write_json(target, result)
        raise
