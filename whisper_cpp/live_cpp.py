from __future__ import annotations

from argparse import ArgumentParser, Namespace
from datetime import datetime
from pathlib import Path
from queue import Empty, Full, Queue
from subprocess import run
from tempfile import TemporaryDirectory
from threading import Event, Thread
import warnings

import numpy as np
import soundfile as sf

import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON_BACKEND = ROOT / "python_backend"
for import_path in (PYTHON_BACKEND, ROOT):
    if str(import_path) not in sys.path:
        sys.path.insert(0, str(import_path))

from record_audio import mix_audio, resample_audio, select_microphone, select_system_loopback


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Capture Windows loopback audio and transcribe chunks with whisper.cpp.")
    parser.add_argument("--output", type=Path, help="Transcript output path")
    parser.add_argument("--save-recording", action="store_true", help="Also save the captured audio")
    parser.add_argument("--recording-output", type=Path, help="Recording output WAV path")
    parser.add_argument("--recording-dir", type=Path, default=Path("output"), help="Directory for timestamped sessions")
    parser.add_argument("--model", type=Path, default=Path("models") / "ggml-small.bin", help="whisper.cpp ggml model path")
    parser.add_argument("--language", default="ja", help="Language code. Default: ja")
    parser.add_argument("--chunk-seconds", type=float, default=3.0, help="Chunk size in seconds. Default: 3")
    parser.add_argument("--capture-block-seconds", type=float, default=0.5, help="Capture block size in seconds. Default: 0.5")
    parser.add_argument("--max-backlog", type=int, default=24, help="Maximum queued chunks before old chunks are dropped")
    parser.add_argument("--sample-rate", type=int, default=16000, help="ASR sample rate. Default: 16000")
    parser.add_argument("--capture-rate", type=int, default=48000, help="Capture sample rate. Default: 48000")
    parser.add_argument("--include-mic", action="store_true", help="Also record and mix the default microphone")
    parser.add_argument("--system-device", help="Substring or id of the loopback device to record")
    parser.add_argument("--mic-device", help="Substring or id of the microphone to record when --include-mic is set")
    parser.add_argument("--gain", type=float, default=1.0, help="Audio gain before saving/transcribing. Default: 1.0")
    parser.add_argument("--whisper-cli", type=Path, help="Path to whisper-cli.exe")
    parser.add_argument("--no-gpu", action="store_true", help="Disable whisper.cpp GPU inference")
    parser.add_argument("--threads", type=int, default=8, help="whisper.cpp CPU thread count. Default: 8")
    parser.add_argument("--show-audio-warnings", action="store_true", help="Show low-level SoundCard recording warnings")
    return parser.parse_args()


def default_recording_path(output_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_dir / f"cpp_live_{stamp}" / "audio.wav"


def default_transcript_path(recording_path: Path | None) -> Path:
    if recording_path:
        return recording_path.with_name("live_transcript.txt")
    return Path("output") / "cpp_live_transcript.txt"


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
    chunk_frames = max(1, int(args.capture_rate * args.chunk_seconds))
    pending: list[np.ndarray] = []
    pending_frames = 0

    recording_file = None
    if args.recording_output:
        recording_file = sf.SoundFile(args.recording_output, mode="w", samplerate=args.sample_rate, channels=1, subtype="PCM_16")

    try:
        with system_device.recorder(samplerate=args.capture_rate) as system_recorder:
            if mic_device is None:
                while not stop_event.is_set():
                    system_chunk = system_recorder.record(numframes=block_frames)
                    mono = mix_audio(system_chunk, None)
                    mono = np.clip(mono * args.gain, -1.0, 1.0)
                    if recording_file:
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
                        mono = np.clip(mono * args.gain, -1.0, 1.0)
                        if recording_file:
                            recording_file.write(resample_audio(mono, args.capture_rate, args.sample_rate))
                        pending.append(mono)
                        pending_frames += len(mono)
                        if pending_frames >= chunk_frames:
                            enqueue_chunk(chunks, np.concatenate(pending))
                            pending = []
                            pending_frames = 0
    finally:
        if recording_file:
            recording_file.close()

    if pending:
        enqueue_chunk(chunks, np.concatenate(pending))


def transcribe_with_cpp(args: Namespace, audio_path: Path) -> str:
    output_base = audio_path.with_suffix("")
    whisper_cli = args.whisper_cli or default_whisper_cli(args.no_gpu)
    command = [
        str(whisper_cli),
        "-m",
        str(args.model),
        "-f",
        str(audio_path),
        "-l",
        args.language,
        "-nt",
        "-np",
        "-otxt",
        "-of",
        str(output_base),
        "-bo",
        "1",
        "-bs",
        "1",
        "-t",
        str(args.threads),
    ]
    if args.no_gpu:
        command.append("--no-gpu")
    completed = run(command, cwd=Path(__file__).resolve().parent, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if completed.returncode != 0:
        print(completed.stderr.strip() or completed.stdout.strip())
        return ""
    transcript_path = output_base.with_suffix(".txt")
    if not transcript_path.exists():
        return completed.stdout.strip()
    text = transcript_path.read_text(encoding="utf-8", errors="replace").strip()
    transcript_path.unlink(missing_ok=True)
    return text


def append_transcript(output_path: Path, text: str) -> None:
    if not text:
        return
    timestamp = datetime.now().strftime("%H:%M:%S")
    with output_path.open("a", encoding="utf-8") as handle:
        handle.write(f"[{timestamp}] {text}\n")
    print(f"[{timestamp}] {text}")


def default_whisper_cli(no_gpu: bool) -> Path:
    if no_gpu:
        return Path("bin_cpu") / "Release" / "whisper-cli.exe"
    return Path("bin_cuda") / "Release" / "whisper-cli.exe"


def run_live(args: Namespace) -> None:
    if args.save_recording:
        args.recording_output = args.recording_output or default_recording_path(args.recording_dir)
    if args.recording_output:
        args.recording_output.parent.mkdir(parents=True, exist_ok=True)
    output_path = args.output or default_transcript_path(args.recording_output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"System loopback: {select_system_loopback(args.system_device).name}")
    if args.include_mic:
        print(f"Microphone: {select_microphone(args.mic_device).name}")
    print(f"Transcript: {output_path}")
    if args.recording_output:
        print(f"Recording: {args.recording_output}")
    print(f"Model: {args.model}")
    print("Press Ctrl+C to stop.")

    chunks: Queue[np.ndarray] = Queue(maxsize=args.max_backlog)
    stop_event = Event()
    capture_thread = Thread(target=capture_audio, args=(args, chunks, stop_event), daemon=True)
    capture_thread.start()

    try:
        with TemporaryDirectory() as temp_dir:
            temp_audio = Path(temp_dir) / "chunk.wav"
            while True:
                mono = chunks.get()
                chunk = resample_audio(mono, args.capture_rate, args.sample_rate)
                sf.write(temp_audio, chunk, args.sample_rate, subtype="PCM_16")
                append_transcript(output_path, transcribe_with_cpp(args, temp_audio))
    finally:
        stop_event.set()
        capture_thread.join(timeout=2.0)


def main() -> None:
    args = parse_args()
    try:
        run_live(args)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
