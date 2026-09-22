"""Fetch pinned models and a small, deterministic FLEURS Japanese test sample."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import io
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "outputs" / "asr_benchmark" / "data"
FLEURS_REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
MODELS = {
    "whisper-small": ("Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120"),
    "whisper-turbo": ("mobiuslabsgmbh/faster-whisper-large-v3-turbo", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"),
    "qwen-0.6b": ("Qwen/Qwen3-ASR-0.6B-hf", "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c"),
    "qwen-1.7b": ("Qwen/Qwen3-ASR-1.7B-hf", "bcd2b5b7f32b480ab5790554cfa8347f246a14f3"),
}


def prepare_audio(count: int) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    manifest_path = DATA / "manifest.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if len(previous["samples"]) == count and all(
            (DATA / item["file"]).exists()
            and hashlib.sha256((DATA / item["file"]).read_bytes()).hexdigest() == item["sha256"]
            for item in previous["samples"]
        ):
            print("Audio manifest already verified", flush=True)
            return
    base = f"https://huggingface.co/datasets/google/fleurs/resolve/{FLEURS_REVISION}/data/ja_jp"
    with urlopen(f"{base}/test.tsv", timeout=60) as response:
        metadata = response.read().decode("utf-8")
    (DATA / "test.tsv").write_text(metadata, encoding="utf-8")
    rows = {row[1]: row for row in csv.reader(io.StringIO(metadata), delimiter="\t")}
    samples = []
    seen_ids = set()
    # Selection uses archive order and unique sentence IDs, never model outputs.
    with urlopen(f"{base}/audio/test.tar.gz", timeout=120) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as archive:
            for member in archive:
                name = Path(member.name).name
                if not member.isfile() or name not in rows:
                    continue
                row = rows[name]
                if row[0] in seen_ids:
                    continue
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                content = handle.read()
                (DATA / name).write_bytes(content)
                seen_ids.add(row[0])
                samples.append({
                    "id": row[0], "file": name, "reference": row[2],
                    "normalized_source_reference": row[3], "gender": row[6],
                    "source_num_samples": int(row[5]),
                    "sha256": hashlib.sha256(content).hexdigest(),
                })
                print(f"Audio {len(samples)}/{count}: {name}", flush=True)
                if len(samples) == count:
                    break
    if len(samples) != count:
        raise RuntimeError(f"Only found {len(samples)} of {count} requested samples")
    manifest = {
        "dataset": "google/fleurs", "revision": FLEURS_REVISION, "config": "ja_jp", "split": "test",
        "license": "CC-BY-4.0", "source": "https://huggingface.co/datasets/google/fleurs",
        "selection": "First unique sentence IDs in the pinned test audio archive; clean read speech, not meetings",
        "samples": samples,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare_model(key: str) -> None:
    from huggingface_hub import snapshot_download

    repo, revision = MODELS[key]
    print(f"Downloading {key}: {repo}@{revision}", flush=True)
    snapshot_download(repo, revision=revision, local_dir=ROOT / "models" / "benchmark" / key)
    print(f"Ready: {key}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--audio-only", action="store_true")
    parser.add_argument("--models", nargs="+", choices=MODELS, default=list(MODELS))
    args = parser.parse_args()
    if args.count < 1:
        parser.error("--count must be positive")
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(prepare_audio, args.count)]
        if not args.audio_only:
            jobs.extend(pool.submit(prepare_model, key) for key in args.models)
        for job in jobs:
            job.result()
