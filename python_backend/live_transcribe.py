from __future__ import annotations

from argparse import ArgumentParser, Namespace
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from queue import Empty, Full, Queue
from tempfile import TemporaryDirectory
from threading import Event, Thread
import warnings

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

from record_audio import mix_audio, resample_audio, select_microphone, select_system_loopback
from live_streaming import run_streaming
from whisper_models import resolve_whisper_model
from session_control import capture_worker, next_chunk, watch_stop_request


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Record system audio in short chunks and append a rough live transcript.")
    parser.add_argument("--output", type=Path, help="Transcript output path")
    parser.add_argument("--save-recording", action="store_true", help="Also save the captured meeting audio to a WAV file")
    parser.add_argument("--recording-output", type=Path, help="Recording output path when --save-recording is set")
    parser.add_argument("--recording-dir", type=Path, default=Path("recordings"), help="Directory for timestamped live recordings")
    parser.add_argument("--model", default="small", help="faster-whisper model name. Default: small")
    parser.add_argument("--language", default="ja", help="Language code, or empty string to auto-detect. Default: ja")
    parser.add_argument("--device", default="cpu", help="Whisper inference device. Default: cpu")
    parser.add_argument("--compute-type", default="int8", help="Whisper compute type. Default: int8")
    parser.add_argument("--chunk-seconds", type=float, default=3.0, help="Chunk size in seconds. Default: 3")
    parser.add_argument("--streaming", action="store_true", help="Use VAD utterances and revisable one-second captions")
    parser.add_argument("--preview-seconds", type=float, default=1.0, help="Streaming preview interval. Default: 1")
    parser.add_argument("--capture-block-seconds", type=float, default=0.5, help="Continuous capture block size in seconds. Default: 0.5")
    parser.add_argument("--max-backlog", type=int, default=1, help="Maximum queued audio chunks before old chunks are dropped")
    parser.add_argument("--sample-rate", type=int, default=16000, help="ASR sample rate. Default: 16000")
    parser.add_argument("--capture-rate", type=int, default=48000, help="Capture sample rate. Default: 48000")
    parser.add_argument("--include-mic", action="store_true", help="Also record and mix the default microphone")
    parser.add_argument("--system-device", help="Substring or id of the loopback device to record")
    parser.add_argument("--mic-device", help="Substring or id of the microphone to record when --include-mic is set")
    parser.add_argument("--show-audio-warnings", action="store_true", help="Show low-level SoundCard recording warnings")
    return parser.parse_args()


def default_recording_path(output_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_dir / f"live_meeting_{stamp}" / "audio.wav"


def default_transcript_path(recording_path: Path | None) -> Path:
    if recording_path:
        return recording_path.with_name("live_transcript.txt")
    return Path("live_transcript.txt")


def transcribe_file(model: WhisperModel, audio_path: Path, language: str | None) -> str:
    segments, _ = model.transcribe(str(audio_path), language=language, beam_size=1, vad_filter=True)
    lines = [segment.text.strip() for segment in segments if segment.text.strip()]
    return " ".join(lines).strip()


def append_transcript(output_path: Path, text: str) -> None:
    if not text:
        return
    timestamp = datetime.now().strftime("%H:%M:%S")
    with output_path.open("a", encoding="utf-8") as handle:
        handle.write(f"[{timestamp}] {text}\n")
    print(f"[{timestamp}] {text}")


def enqueue_chunk(chunks: Queue[np.ndarray], audio: np.ndarray) -> None:
    try:
        chunks.put_nowait(audio)
        return
    except Full:
        try:
            chunks.get_nowait()
        except Empty:
            pass
    chunks.put_nowait(audio)
    print("Warning: transcription is behind; dropped one queued audio chunk.")


def capture_audio(args: Namespace, chunks: Queue[np.ndarray], stop_event: Event) -> None:
    if not args.show_audio_warnings:
        warnings.filterwarnings("ignore", message="data discontinuity in recording")

    system_device = select_system_loopback(args.system_device)
    mic_device = select_microphone(args.mic_device) if args.include_mic else None
    block_frames = max(1, int(args.capture_rate * args.capture_block_seconds))
    chunk_frames = block_frames if args.streaming else max(1, int(args.capture_rate * args.chunk_seconds))
    pending: list[np.ndarray] = []
    pending_frames = 0
    recording_context = (
        sf.SoundFile(args.recording_output, mode="w", samplerate=args.sample_rate, channels=1, subtype="PCM_16")
        if args.recording_output
        else nullcontext()
    )

    with recording_context as recording_file:
        with system_device.recorder(samplerate=args.capture_rate) as system_recorder:
            if mic_device is None:
                while not stop_event.is_set():
                    system_chunk = system_recorder.record(numframes=block_frames)
                    mono = mix_audio(system_chunk, None)
                    if recording_file is not None:
                        recording_file.write(resample_audio(mono, args.capture_rate, args.sample_rate))
                    pending.append(mono)
                    pending_frames += len(mono)
                    if pending_frames >= chunk_frames:
                        enqueue_chunk(chunks, np.concatenate(pending))
                        pending = []
                        pending_frames = 0
            else:
                with mic_device.recorder(samplerate=args.capture_rate) as mic_recorder:
                    while not stop_event.is_set():
                        system_chunk = system_recorder.record(numframes=block_frames)
                        mic_chunk = mic_recorder.record(numframes=block_frames)
                        mono = mix_audio(system_chunk, mic_chunk)
                        if recording_file is not None:
                            recording_file.write(resample_audio(mono, args.capture_rate, args.sample_rate))
                        pending.append(mono)
                        pending_frames += len(mono)
                        if pending_frames >= chunk_frames:
                            enqueue_chunk(chunks, np.concatenate(pending))
                            pending = []
                            pending_frames = 0

    if pending:
        enqueue_chunk(chunks, np.concatenate(pending))


def run_live(args: Namespace) -> None:
    if args.save_recording:
        args.recording_output = args.recording_output or default_recording_path(args.recording_dir)
    if args.recording_output:
        args.recording_output.parent.mkdir(parents=True, exist_ok=True)
    output_path = args.output or default_transcript_path(args.recording_output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    language = args.language or None
    system_device = select_system_loopback(args.system_device)
    mic_device = select_microphone(args.mic_device) if args.include_mic else None

    print(f"System loopback: {system_device.name}")
    if mic_device:
        print(f"Microphone: {mic_device.name}")
    print(f"Transcript: {output_path}")
    if args.recording_output:
        print(f"Recording: {args.recording_output}")
    print("Press Ctrl+C to stop.")

    model_name_or_path = resolve_whisper_model(args.model)
    print(f"Model: {model_name_or_path}")

    model = WhisperModel(model_name_or_path, device=args.device, compute_type=args.compute_type)
    chunks: Queue[np.ndarray] = Queue(maxsize=0 if args.streaming else args.max_backlog)
    stop_event = Event()
    watch_stop_request(stop_event)
    capture_errors: list[Exception] = []
    capture_thread = Thread(target=capture_worker, args=(capture_audio, args, chunks, stop_event, capture_errors), daemon=True)
    capture_thread.start()
    print("Ready: model loaded; audio capture started.")

    try:
        if args.streaming:
            def transcribe_stream(audio: np.ndarray) -> str:
                segments, _ = model.transcribe(
                    audio, language=language, beam_size=1, temperature=0,
                    condition_on_previous_text=False, vad_filter=False,
                )
                return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()

            run_streaming(
                chunks, stop_event, capture_errors, args.capture_rate, args.sample_rate,
                output_path, transcribe_stream, resample_audio, args.preview_seconds,
            )
        else:
            with TemporaryDirectory() as temp_dir:
                temp_audio = Path(temp_dir) / "chunk.wav"
                while True:
                    mono = next_chunk(chunks, stop_event, capture_errors)
                    if mono is None:
                        break
                    chunk = resample_audio(mono, args.capture_rate, args.sample_rate)
                    sf.write(temp_audio, chunk, args.sample_rate, subtype="PCM_16")
                    append_transcript(output_path, transcribe_file(model, temp_audio, language))
    finally:
        stop_event.set()
        capture_thread.join(timeout=5.0)
        if capture_thread.is_alive():
            raise RuntimeError("Audio device did not stop; recording may be incomplete")
        if capture_errors:
            raise RuntimeError(f"Audio capture failed: {capture_errors[0]}") from capture_errors[0]
    print("Stopped: recording closed; exiting model worker.")


def main() -> None:
    args = parse_args()
    try:
        run_live(args)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
