"""Download only the pinned Transformers files for local Nemotron inference."""
from huggingface_hub import snapshot_download

from prepare import ROOT

MODEL_ID = "nvidia/nemotron-3.5-asr-streaming-0.6b"
REVISION = "ea30d66debe3740a08b573244286791d423d6b3e"
MODEL_DIR = ROOT / "models" / "benchmark" / "nemotron-0.6b"

if __name__ == "__main__":
    snapshot_download(
        MODEL_ID, revision=REVISION, local_dir=MODEL_DIR,
        allow_patterns=["*.json", "*.safetensors", "*.md"],
    )
    print(f"Ready: {MODEL_ID}@{REVISION}", flush=True)
