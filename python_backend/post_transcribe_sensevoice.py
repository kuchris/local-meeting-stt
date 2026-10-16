"""Transcribes a recording with SenseVoice-Small through sherpa-onnx: int8 on CPU, fp32 on CUDA.

SenseVoice recognizes up to about 30 s at a time, so Silero VAD splits the
recording into utterances first; each becomes one line of the transcript.
"""
from __future__ import annotations

from argparse import ArgumentParser, Namespace
from pathlib import Path
import time

import numpy as np
import soundfile as sf

from text_script import SCRIPTS, converter

SAMPLE_RATE = 16000
LANGUAGES = ("auto", "zh", "yue", "en", "ja")


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Transcribe a recording with SenseVoice-Small.")
    parser.add_argument("audio", type=Path, help="Recording to transcribe")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Transcript output path")
    parser.add_argument("--model", type=Path, default=Path("models") / "SenseVoiceSmall", help="sherpa-onnx SenseVoice model folder")
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu", help="ONNX Runtime provider. Default: cpu")
    parser.add_argument("--threads", type=int, default=4, help="CPU threads. Default: 4")
    parser.add_argument("--language", choices=LANGUAGES, default="auto", help="Recognition language. Default: auto")
    parser.add_argument("--chinese-script", choices=SCRIPTS, default="as-is", help="Convert Chinese text to Traditional (HK) or Simplified. Default: as-is")
    parser.add_argument("--max-segment-seconds", type=float, default=25.0, help="Longest utterance sent at once. Default: 25")
    return parser.parse_args()


def load_audio(path: Path) -> np.ndarray:
    audio, rate = sf.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != SAMPLE_RATE:
        import soxr

        audio = soxr.resample(audio, rate, SAMPLE_RATE).astype(np.float32)
    return audio


def speech_segments(audio: np.ndarray, max_seconds: float, window_seconds: float = 60.0) -> list[tuple[int, int]]:
    """Silero VAD in 60 s windows. Over a whole 2-minute file it missed the final
    15 s sentence that it found in that part alone. Speech running into the next
    window starts that window, so no utterance is cut at a window edge."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    options = VadOptions(threshold=0.5, min_speech_duration_ms=150, min_silence_duration_ms=500,
                         speech_pad_ms=200, max_speech_duration_s=max_seconds)
    window, margin = round(window_seconds * SAMPLE_RATE), round(0.5 * SAMPLE_RATE)
    segments: list[tuple[int, int]] = []
    cursor = 0
    while cursor < len(audio):
        end = min(len(audio), cursor + window)
        next_cursor = end
        for span in get_speech_timestamps(audio[cursor:end], options, sampling_rate=SAMPLE_RATE):
            start, stop = cursor + int(span["start"]), cursor + int(span["end"])
            if end < len(audio) and stop >= end - margin and start > cursor:
                next_cursor = start
                break
            segments.append((start, stop))
        cursor = next_cursor
    return segments


def main() -> None:
    args = parse_args()
    if not args.audio.exists():
        raise SystemExit(f"Audio file not found: {args.audio}")
    model_file = args.model / ("model.onnx" if args.provider == "cuda" else "model.int8.onnx")
    if not model_file.exists():
        raise SystemExit(f"Local model missing: {model_file}. Download it from Settings first.")
    if args.provider == "cuda":
        import cuda_dlls  # noqa: F401  (CUDA 12 / cuDNN 9 DLLs from NVIDIA's pip packages)
    import sherpa_onnx

    started = time.perf_counter()
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_file), tokens=str(args.model / "tokens.txt"), num_threads=args.threads,
        use_itn=True, language=args.language, provider=args.provider,
    )
    print(f"Model ready ({time.perf_counter() - started:.2f}s): SenseVoice-Small ({args.provider})", flush=True)
    audio = load_audio(args.audio)
    segments = speech_segments(audio, args.max_segment_seconds)
    print(f"Audio: {len(audio) / SAMPLE_RATE:.1f}s, {len(segments)} speech segments", flush=True)

    convert = converter(args.chinese_script, args.language)
    lines = []
    for index in range(0, len(segments), 16):
        batch = segments[index:index + 16]
        streams = []
        for start, end in batch:
            stream = recognizer.create_stream()
            stream.accept_waveform(SAMPLE_RATE, audio[start:end])
            streams.append(stream)
        recognizer.decode_streams(streams)
        for stream in streams:
            text = stream.result.text.strip()
            if text:
                # A segment SenseVoice heard as Japanese keeps its kanji.
                lines.append(text if stream.result.lang == "<|ja|>" else convert(text))
        print(f"Transcribed {min(index + 16, len(segments))}/{len(segments)} segments", flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    print(f"Wrote: {args.output} ({len(lines)} lines, {time.perf_counter() - started:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
