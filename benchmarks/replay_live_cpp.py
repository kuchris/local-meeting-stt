"""Compare fixed chunks with the app's speech-aware whisper.cpp live path.

Uses the local CUDA server and pinned public audio, without opening audio devices.
The result is a virtual replay: capture/UI latency and real meetings are separate.
"""
from __future__ import annotations

from argparse import ArgumentParser, Namespace
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

import numpy as np
import soundfile as sf
import requests

from metrics import score
from prepare import DATA, ROOT
from run import percentile, write_json

sys.path.insert(0, str(ROOT / "whisper_cpp"))
sys.path.insert(0, str(ROOT / "python_backend"))
import live_cpp
from live_cpp import start_whisper_server, stop_whisper_server, transcribe_with_server
from live_streaming import SpeechSegmenter


def drain_server_log(process, stop_event) -> None:
    for _ in process.stdout:
        if stop_event.is_set():
            break


live_cpp.stream_process_output = drain_server_log


def main() -> None:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=("small", "turbo"), default="small")
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--gain", type=float, default=1.0)
    parser.add_argument("--realtime", action="store_true", help="Pace the streaming half by audio arrival time")
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/asr_benchmark/live-cpp.json")
    args = parser.parse_args()
    model_file = "ggml-small.bin" if args.model == "small" else "ggml-large-v3-turbo.bin"
    server_args = Namespace(
        model=ROOT / "whisper_cpp/models" / model_file,
        whisper_server=ROOT / "whisper_cpp" / ("bin_cuda" if args.device == "cuda" else "bin_cpu") / "Release/whisper-server.exe",
        server_host="127.0.0.1", server_port=None, server_timeout=60.0,
        language="ja", threads=8, no_gpu=args.device == "cpu", openvino_device=None,
        beam_size=1, best_of=1, no_fallback=False, silence_rms=0.003,
        sample_rate=16000,
    )
    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    result = {"model": args.model, "model_file": model_file, "device": args.device, "gain": args.gain,
              "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              "mode": f"{args.device} resident server, " + ("wall-clock paced stream" if args.realtime else "virtual 0.5-second audio arrivals"),
              "limitations": "Public read speech; no microphone, loopback device, or renderer timing", "samples": []}
    process, url, output_stop, output_thread = start_whisper_server(server_args)
    try:
        with requests.Session() as session:
            for item in manifest["samples"][:args.count]:
                path = DATA / item["file"]
                if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
                    raise ValueError(f"Audio checksum mismatch: {path}")
                audio, rate = sf.read(path, dtype="float32")
                if rate != 16000 or audio.ndim != 1:
                    raise ValueError("Expected mono 16 kHz audio")
                audio = np.clip(audio * args.gain, -1.0, 1.0)
                fixed_texts = []
                fixed_times = []
                for offset in range(0, len(audio), 3 * rate):
                    started = time.perf_counter()
                    fixed_texts.append(transcribe_with_server(server_args, session, url, audio[offset:offset + 3 * rate]))
                    fixed_times.append(time.perf_counter() - started)
                segmenter = SpeechSegmenter()
                finals, events = [], []
                replay_start = time.perf_counter()
                for offset in range(0, len(audio), rate // 2):
                    arrived = min(len(audio), offset + rate // 2) / rate
                    if args.realtime:
                        time.sleep(max(0, arrived - (time.perf_counter() - replay_start)))
                    for request in segmenter.feed(audio[offset:offset + rate // 2]):
                        queued = max(0.0, time.perf_counter() - replay_start - arrived) if args.realtime else None
                        started = time.perf_counter()
                        text = transcribe_with_server(server_args, session, url, request.audio)
                        elapsed = time.perf_counter() - started
                        events.append({"kind": request.kind, "audio_end": arrived,
                                       "clip_seconds": len(request.audio) / rate,
                                       "inference_seconds": elapsed,
                                       "emitted_at": time.perf_counter() - replay_start if args.realtime else None,
                                       "queue_seconds": queued, "text": text})
                        if request.kind == "final":
                            finals.append(text)
                for request in segmenter.finish():
                    started = time.perf_counter()
                    text = transcribe_with_server(server_args, session, url, request.audio)
                    events.append({"kind": "final", "audio_end": len(audio) / rate,
                                   "clip_seconds": len(request.audio) / rate,
                                   "inference_seconds": time.perf_counter() - started,
                                   "emitted_at": time.perf_counter() - replay_start if args.realtime else None,
                                   "queue_seconds": None, "text": text})
                    finals.append(text)
                fixed_text = "".join(fixed_texts)
                stream_text = "".join(finals)
                row = {"id": item["id"], "reference": item["reference"],
                       "fixed": {"text": fixed_text, "times": fixed_times, **score(item["reference"], fixed_text)},
                       "stream": {"text": stream_text, "events": events,
                                  "first_caption_seconds": next((e["emitted_at"] for e in events if e["text"]), None),
                                  **score(item["reference"], stream_text)}}
                result["samples"].append(row)
                write_json(args.output, result)
                print(f"{args.model} {len(result['samples'])}/{args.count}: fixed {row['fixed']['cer']:.1%}, stream {row['stream']['cer']:.1%}", flush=True)
    finally:
        stop_whisper_server(process, output_stop, output_thread)
    chars = sum(row["fixed"]["reference_chars"] for row in result["samples"])
    events = [event for row in result["samples"] for event in row["stream"]["events"]]
    result["summary"] = {
        "fixed_cer": sum(row["fixed"]["errors"] for row in result["samples"]) / chars,
        "stream_cer": sum(row["stream"]["errors"] for row in result["samples"]) / chars,
        "fixed_inference_p95_seconds": percentile([t for row in result["samples"] for t in row["fixed"]["times"]], .95),
        "stream_inference_p95_seconds": percentile([event["inference_seconds"] for event in events], .95),
        "previews": sum(event["kind"] == "partial" for event in events),
        "finals": sum(event["kind"] == "final" for event in events),
    }
    if args.realtime:
        result["summary"].update({
            "first_caption_p50_seconds": statistics.median(row["stream"]["first_caption_seconds"] for row in result["samples"] if row["stream"]["first_caption_seconds"] is not None),
            "update_lag_p95_seconds": percentile([event["emitted_at"] - event["audio_end"] for event in events], .95),
            "max_queue_seconds": max(event["queue_seconds"] or 0 for event in events),
        })
    write_json(args.output, result)
    print(json.dumps(result["summary"]), flush=True)


if __name__ == "__main__":
    main()
