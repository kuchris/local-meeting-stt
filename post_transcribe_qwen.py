from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path

LOCAL_MODEL_PATH = Path("models") / "Qwen3-ASR-0.6B"
REMOTE_MODEL_NAME = "Qwen/Qwen3-ASR-0.6B"


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Post-process a meeting recording with Qwen3-ASR.")
    parser.add_argument("audio", type=Path, help="Recording to transcribe")
    parser.add_argument("-o", "--output", type=Path, help="Transcript output path")
    parser.add_argument("--model", help="Qwen3-ASR model name or local model path")
    parser.add_argument("--language", default="Japanese", help="Language name passed to Qwen3-ASR. Default: Japanese")
    parser.add_argument("--device", default="auto", help="auto, cuda:0, or cpu. Default: auto")
    parser.add_argument("--max-new-tokens", type=int, default=4096, help="Maximum output tokens. Default: 4096")
    parser.add_argument("--batch-size", type=int, default=1, help="Maximum inference batch size. Default: 1")
    return parser.parse_args()


def default_output_path(audio_path: Path) -> Path:
    return audio_path.with_name(f"{audio_path.stem}_qwen_transcript.txt")


def default_model_path() -> str:
    if LOCAL_MODEL_PATH.exists():
        return str(LOCAL_MODEL_PATH)
    return REMOTE_MODEL_NAME


def resolve_runtime(device_arg: str):
    import torch

    if device_arg == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    else:
        device = device_arg

    dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
    return torch, device, dtype


def extract_text(result) -> str:
    if hasattr(result, "text"):
        return str(result.text).strip()
    if isinstance(result, dict) and "text" in result:
        return str(result["text"]).strip()
    return str(result).strip()


def main() -> None:
    args = parse_args()
    if not args.audio.exists():
        raise SystemExit(f"Audio file not found: {args.audio}")

    try:
        from qwen_asr import Qwen3ASRModel
    except ImportError as exc:
        raise SystemExit("qwen-asr is not installed. Run through post_transcribe_qwen.cmd or uv --with qwen-asr.") from exc

    _, device, dtype = resolve_runtime(args.device)
    output_path = args.output or default_output_path(args.audio)
    model_name_or_path = args.model or default_model_path()

    print(f"Model: {model_name_or_path}")
    print(f"Device: {device}")
    print(f"Audio: {args.audio}")

    model = Qwen3ASRModel.from_pretrained(
        model_name_or_path,
        dtype=dtype,
        device_map=device,
        max_inference_batch_size=args.batch_size,
        max_new_tokens=args.max_new_tokens,
    )
    results = model.transcribe(audio=str(args.audio), language=args.language or None)
    text = "\n".join(extract_text(result) for result in results).strip()
    if text:
        text += "\n"

    output_path.write_text(text, encoding="utf-8")
    print(f"Wrote: {output_path} ({len(text)} chars)")


if __name__ == "__main__":
    main()
