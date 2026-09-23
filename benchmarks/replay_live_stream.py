"""Replay public Japanese speech through the app's live VAD/preview policy.

The microphone is never opened. Audio arrives in 0.5-second blocks without
sleeping; timings cover warmed VAD and ASR processing, not wall-clock capture.
"""
from __future__ import annotations

from argparse import ArgumentParser
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
import soundfile as sf

from metrics import score
from prepare import DATA, ROOT
from run import Engine, percentile, write_json

sys.path.insert(0, str(ROOT / "python_backend"))
from live_streaming import SpeechSegmenter


def main() -> None:
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="whisper-turbo", choices=("whisper-turbo", "whisper-small"))
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--output", type=Path, default=ROOT / "outputs/asr_benchmark/live-stream.json")
    args = parser.parse_args()
    manifest_path = DATA / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    engine = Engine(args.model)
    result = {"model": args.model, "manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
              "mode": "app VAD and cumulative preview; virtual 0.5-second audio arrivals", "samples": []}
    for item in manifest["samples"][:args.count]:
        path = DATA / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Audio checksum mismatch: {path}")
        audio, rate = sf.read(path, dtype="float32")
        if rate != 16000 or audio.ndim != 1:
            raise ValueError("Expected mono 16 kHz audio")
        segmenter = SpeechSegmenter()
        final_texts = []
        events = []
        elapsed_processing = 0.0
        for offset in range(0, len(audio), 8000):
            block = audio[offset:offset + 8000]
            arrived = min(len(audio), offset + 8000) / rate
            started = time.perf_counter()
            requests = segmenter.feed(block)
            vad_seconds = time.perf_counter() - started
            elapsed_processing += vad_seconds
            for request in requests:
                engine.torch.cuda.synchronize()
                started = time.perf_counter()
                segments, _ = engine.model.transcribe(
                    request.audio, language="ja", beam_size=1, temperature=0,
                    condition_on_previous_text=False, vad_filter=False,
                )
                text = "".join(segment.text.strip() for segment in segments)
                engine.torch.cuda.synchronize()
                inference_seconds = time.perf_counter() - started
                elapsed_processing += inference_seconds
                if request.kind == "final":
                    final_texts.append(text)
                events.append({"kind": request.kind, "audio_end": arrived, "text": text,
                               "clip_seconds": len(request.audio) / rate,
                               "vad_seconds": vad_seconds, "inference_seconds": inference_seconds})
        for request in segmenter.finish():
            engine.torch.cuda.synchronize()
            started = time.perf_counter()
            segments, _ = engine.model.transcribe(
                request.audio, language="ja", beam_size=1, temperature=0,
                condition_on_previous_text=False, vad_filter=False,
            )
            text = "".join(segment.text.strip() for segment in segments)
            engine.torch.cuda.synchronize()
            inference_seconds = time.perf_counter() - started
            elapsed_processing += inference_seconds
            final_texts.append(text)
            events.append({"kind": "final", "audio_end": len(audio) / rate, "text": text,
                           "clip_seconds": len(request.audio) / rate, "inference_seconds": inference_seconds})
        text = "".join(final_texts)
        row = {"id": item["id"], "reference": item["reference"], "text": text,
               "audio_seconds": len(audio) / rate, "processing_seconds": elapsed_processing,
               "events": events, **score(item["reference"], text)}
        result["samples"].append(row)
        print(f"{args.model} live replay {len(result['samples'])}/{args.count}: CER {row['cer']:.1%}, {len(final_texts)} finals", flush=True)
        write_json(args.output, result)
    chars = sum(row["reference_chars"] for row in result["samples"])
    result["summary"] = {"cer": sum(row["errors"] for row in result["samples"]) / chars,
                         "finals": sum(sum(event["kind"] == "final" for event in row["events"]) for row in result["samples"]),
                         "previews": sum(sum(event["kind"] == "partial" for event in row["events"]) for row in result["samples"]),
                         "inference_p95_seconds": percentile(
                             [event["inference_seconds"] for row in result["samples"] for event in row["events"]], .95)}
    write_json(args.output, result)
    print(json.dumps(result["summary"]), flush=True)


if __name__ == "__main__":
    main()
