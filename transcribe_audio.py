from argparse import ArgumentParser
from pathlib import Path

from faster_whisper import WhisperModel

from whisper_models import resolve_whisper_model


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_transcript.txt")


def parse_args():
    parser = ArgumentParser(description="Transcribe an audio file with faster-whisper.")
    parser.add_argument("audio", type=Path, help="Audio file to transcribe, for example audio.mp3")
    parser.add_argument("-o", "--output", type=Path, help="Transcript output path")
    parser.add_argument("--model", default="medium", help="Whisper model size/name. Default: medium")
    parser.add_argument("--language", default="ja", help="Language code, or empty string to auto-detect. Default: ja")
    parser.add_argument("--device", default="cpu", help="Device for inference. Default: cpu")
    parser.add_argument("--compute-type", default="int8", help="CTranslate2 compute type. Default: int8")
    return parser.parse_args()


def main():
    args = parse_args()
    audio_path = args.audio
    output_path = args.output or default_output_path(audio_path)
    language = args.language or None

    if not audio_path.exists():
        raise SystemExit(f"Audio file not found: {audio_path}")

    model_name_or_path = resolve_whisper_model(args.model)
    print(f"Model: {model_name_or_path}")

    model = WhisperModel(model_name_or_path, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=5,
        vad_filter=True,
    )

    lines = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            lines.append(text)

    transcript = "\n".join(lines).strip()
    if transcript:
        transcript += "\n"

    output_path.write_text(transcript, encoding="utf-8")
    print(f"Language: {info.language} ({info.language_probability:.3f})")
    print(f"Wrote: {output_path} ({len(transcript)} chars)")


if __name__ == "__main__":
    main()
