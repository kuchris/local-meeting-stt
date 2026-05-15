from pathlib import Path

LOCAL_MODEL_DIR = Path("models")


def resolve_whisper_model(model: str) -> str:
    local_path = LOCAL_MODEL_DIR / f"faster-whisper-{model}"
    if local_path.exists():
        return str(local_path)
    return model
