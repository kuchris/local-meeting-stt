from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path
import time

LOCAL_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "Qwen3-ASR-0.6B"


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Post-process a meeting recording with Qwen3-ASR.")
    parser.add_argument("audio", type=Path, help="Recording to transcribe")
    parser.add_argument("-o", "--output", type=Path, help="Transcript output path")
    parser.add_argument("--model", help="Local Qwen3-ASR model directory")
    parser.add_argument("--language", default="Japanese", help="Language name passed to Qwen3-ASR. Default: Japanese")
    parser.add_argument("--device", default="auto", help="auto, cuda:0, or cpu. Default: auto")
    parser.add_argument("--max-new-tokens", type=int, default=4096, help="Maximum output tokens. Default: 4096")
    parser.add_argument("--chunk-seconds", type=float, default=60.0, help="Manual audio chunk size in seconds. Default: 60")
    parser.add_argument("--batch-size", type=int, default=4, help="Maximum inference batch size. Default: 4")
    return parser.parse_args()


def default_output_path(audio_path: Path) -> Path:
    return audio_path.with_name(f"{audio_path.stem}_qwen_transcript.txt")


def default_model_path() -> str:
    if LOCAL_MODEL_PATH.exists():
        return str(LOCAL_MODEL_PATH)
    raise FileNotFoundError(f"Local model missing: {LOCAL_MODEL_PATH}. Download Qwen3-ASR from Setup first.")


def resolve_runtime(device_arg: str):
    import torch

    if device_arg == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    else:
        device = device_arg

    if device.startswith("cuda"):
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. Select Qwen CPU or install the GPU runtime.")
        try:
            # Exercise a kernel: device detection alone does not prove GPU support.
            (torch.ones(1, device=device) + 1).item()
        except RuntimeError as exc:
            raise RuntimeError(f"GPU runtime incompatible: torch={torch.__version__}, CUDA={torch.version.cuda}. Run the supplied Qwen launcher (CUDA 12.8).") from exc
    dtype = torch.bfloat16 if device.startswith("cuda") and torch.cuda.is_bf16_supported() else torch.float16 if device.startswith("cuda") else torch.float32
    return torch, device, dtype


def extract_text(result) -> str:
    if hasattr(result, "text"):
        return str(result.text).strip()
    if isinstance(result, dict) and "text" in result:
        return str(result["text"]).strip()
    return str(result).strip()


def load_audio_chunks(audio_path: Path, chunk_seconds: float):
    from qwen_asr.inference.qwen3_asr import SAMPLE_RATE, normalize_audios, split_audio_into_chunks

    if chunk_seconds <= 0:
        return str(audio_path)

    wavs = normalize_audios(str(audio_path))
    chunks = []
    for wav in wavs:
        for chunk, _ in split_audio_into_chunks(wav=wav, sr=SAMPLE_RATE, max_chunk_sec=chunk_seconds):
            chunks.append((chunk, SAMPLE_RATE))
    return chunks


def main() -> None:
    args = parse_args()
    if args.batch_size < 1 or args.max_new_tokens < 1 or args.chunk_seconds < 0:
        raise SystemExit("batch-size/tokens must be positive and chunk-seconds must be nonnegative")
    if not args.audio.exists():
        raise SystemExit(f"Audio file not found: {args.audio}")

    try:
        from qwen_asr import Qwen3ASRModel
    except ImportError as exc:
        raise SystemExit("qwen-asr is not installed. Run through python_backend/post_transcribe_qwen.cmd or uv --with qwen-asr.") from exc

    _, device, dtype = resolve_runtime(args.device)
    output_path = args.output or default_output_path(args.audio)
    model_name_or_path = args.model or default_model_path()
    if not Path(model_name_or_path).is_dir():
        raise SystemExit(f"Local model missing: {model_name_or_path}. Download it from Setup first.")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Model: {model_name_or_path}")
    print(f"Device: {device}")
    print(f"Audio: {args.audio}")
    print(f"Chunk seconds: {args.chunk_seconds}")

    started = time.perf_counter()
    print("Loading local model...", flush=True)
    model = Qwen3ASRModel.from_pretrained(
        model_name_or_path,
        dtype=dtype,
        device_map=device,
        max_inference_batch_size=args.batch_size,
        max_new_tokens=args.max_new_tokens,
        local_files_only=True,
    )
    print(f"Model ready ({time.perf_counter() - started:.2f}s). Transcribing...", flush=True)
    audio_input = load_audio_chunks(args.audio, args.chunk_seconds)
    results = model.transcribe(audio=audio_input, language=args.language or None)
    text = "\n".join(extract_text(result) for result in results).strip()
    if text:
        text += "\n"

    output_path.write_text(text, encoding="utf-8")
    print(f"Wrote: {output_path} ({len(text)} chars)")


if __name__ == "__main__":
    main()
