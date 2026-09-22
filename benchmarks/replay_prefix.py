"""Wall-clock replay with revisable prefixes; known utterance boundaries only.

This isolates context loss from inference speed. It is not production VAD or
native streaming. Each new caption replaces the previous preview; only the final
utterance caption is scored. The microphone and speakers are never opened.
"""
import argparse
import hashlib
import json
import statistics
import time
from pathlib import Path

from metrics import score
from prepare import DATA, MODELS
from run import Engine, percentile, write_json


def main():
    import soundfile as sf

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=MODELS, default="whisper-turbo")
    parser.add_argument("--count", type=int, default=4)
    parser.add_argument("--step-seconds", type=float, default=1)
    parser.add_argument("--output", type=Path, default=DATA.parent / "prefix_replay.json")
    args = parser.parse_args()
    if args.step_seconds <= 0 or args.count < 1:
        parser.error("step-seconds and count must be positive")
    manifest_bytes = (DATA / "manifest.json").read_bytes()
    manifest = json.loads(manifest_bytes)
    engine = Engine(args.model)
    first, rate = sf.read(DATA / manifest["samples"][0]["file"], dtype="float32")
    engine.timed(first[:rate])
    result = {
        "model": args.model, "model_source": MODELS[args.model], "status": "running",
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "protocol": "Wall-clock audio arrival; cumulative utterance prefix; revisable previews; oracle utterance boundaries; no WASAPI/UI",
        "step_seconds": args.step_seconds, "samples": [],
    }
    for item in manifest["samples"][:args.count]:
        path = DATA / item["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError(f"Checksum mismatch: {path}")
        audio, rate = sf.read(path, dtype="float32")
        if rate != 16000 or audio.ndim != 1:
            raise ValueError("Expected mono 16 kHz audio")
        step = round(args.step_seconds * rate)
        ends = list(range(step, len(audio), step)) + [len(audio)]
        updates = []
        started = time.perf_counter()
        for end in ends:
            arrived = end / rate
            time.sleep(max(0, arrived - (time.perf_counter() - started)))
            inference_start = time.perf_counter() - started
            text, seconds = engine.timed(audio[:end])
            elapsed = time.perf_counter() - started
            updates.append({"audio_end": arrived, "emitted_at": elapsed, "text": text,
                            "inference_seconds": seconds, "lag_seconds": elapsed - arrived,
                            "queue_seconds": max(0, inference_start - arrived)})
        result["samples"].append({
            "id": item["id"], "reference": item["reference"], "updates": updates,
            "first_caption_seconds": next((u["emitted_at"] for u in updates if u["text"]), None),
            "final_text": updates[-1]["text"], **score(item["reference"], updates[-1]["text"]),
        })
        write_json(args.output, result)
        print(f"Prefix replay {len(result['samples'])}/{args.count}: first caption {result['samples'][-1]['first_caption_seconds']}", flush=True)
    updates = [u for item in result["samples"] for u in item["updates"]]
    chars = sum(item["reference_chars"] for item in result["samples"])
    result["summary"] = {
        "final_cer": sum(item["errors"] for item in result["samples"]) / chars,
        "first_caption_p50_seconds": statistics.median(item["first_caption_seconds"] for item in result["samples"] if item["first_caption_seconds"] is not None),
        "update_lag_p95_seconds": percentile([u["lag_seconds"] for u in updates], .95),
        "max_queue_seconds": max(u["queue_seconds"] for u in updates),
        "updates": len(updates),
    }
    result["status"] = "complete"
    write_json(args.output, result)
    print(json.dumps(result["summary"]), flush=True)


if __name__ == "__main__":
    main()
