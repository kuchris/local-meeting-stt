from __future__ import annotations

from argparse import ArgumentParser, Namespace
from datetime import datetime
from io import BytesIO
import os
from pathlib import Path
from queue import Empty, Full, Queue
import socket
from subprocess import Popen, TimeoutExpired, run
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
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
    parser.add_argument("--session-prefix", default="cpp_live", help="Prefix for timestamped live session folders. Default: cpp_live")
    parser.add_argument("--model", type=Path, default=Path("models") / "ggml-small.bin", help="whisper.cpp ggml model path")
    parser.add_argument("--language", default="ja", help="Language code. Default: ja")
    parser.add_argument("--chunk-seconds", type=float, default=3.0, help="Chunk size in seconds. Default: 3")
    parser.add_argument("--capture-block-seconds", type=float, default=0.5, help="Capture block size in seconds. Default: 0.5")
    parser.add_argument("--max-backlog", type=int, default=1, help="Maximum queued chunks before old chunks are dropped")
    parser.add_argument("--sample-rate", type=int, default=16000, help="ASR sample rate. Default: 16000")
    parser.add_argument("--capture-rate", type=int, default=48000, help="Capture sample rate. Default: 48000")
    parser.add_argument("--include-mic", action="store_true", help="Also record and mix the default microphone")
    parser.add_argument("--system-device", help="Substring or id of the loopback device to record")
    parser.add_argument("--mic-device", help="Substring or id of the microphone to record when --include-mic is set")
    parser.add_argument("--gain", type=float, default=1.0, help="Audio gain before saving/transcribing. Default: 1.0")
    parser.add_argument("--whisper-cli", type=Path, help="Path to whisper-cli.exe")
    parser.add_argument("--whisper-server", type=Path, help="Path to whisper-server.exe")
    parser.add_argument("--server", action="store_true", help="Use resident whisper-server.exe instead of spawning whisper-cli.exe per chunk")
    parser.add_argument("--server-host", default="127.0.0.1", help="whisper-server bind host. Default: 127.0.0.1")
    parser.add_argument("--server-port", type=int, help="whisper-server port. Default: auto")
    parser.add_argument("--server-timeout", type=float, default=60.0, help="Seconds to wait for each server inference response. Default: 60")
    parser.add_argument("--silence-rms", type=float, default=0.003, help="Skip server inference below this chunk RMS. Default: 0.003")
    parser.add_argument("--no-gpu", action="store_true", help="Disable whisper.cpp GPU inference")
    parser.add_argument("--threads", type=int, help="whisper.cpp CPU thread count. Default: auto")
    parser.add_argument("--openvino-device", help="OpenVINO encoder device for whisper-server, for example NPU, GPU, or CPU")
    parser.add_argument("--beam-size", type=int, help="whisper.cpp beam size")
    parser.add_argument("--best-of", type=int, help="whisper.cpp best-of count")
    parser.add_argument("--no-fallback", action="store_true", help="Disable temperature fallback while decoding")
    parser.add_argument("--show-audio-warnings", action="store_true", help="Show low-level SoundCard recording warnings")
    return parser.parse_args()


def default_recording_path(output_dir: Path, prefix: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_prefix = "".join(char if char.isalnum() or char in "-_" else "_" for char in prefix).strip("_") or "cpp_live"
    return output_dir / f"{safe_prefix}_{stamp}" / "audio.wav"


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


def get_latest_chunk(chunks: Queue[np.ndarray]) -> np.ndarray:
    audio = chunks.get()
    while True:
        try:
            audio = chunks.get_nowait()
            print("Warning: transcription is behind; skipped stale audio chunk.")
        except Empty:
            return audio


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


def transcribe_with_server(args: Namespace, session, url: str, chunk: np.ndarray) -> str:
    if np.sqrt(np.mean(np.square(chunk))) < args.silence_rms:
        return ""

    wav_data = BytesIO()
    sf.write(wav_data, chunk, args.sample_rate, format="WAV", subtype="PCM_16")
    wav_data.seek(0)

    response = session.post(
        url,
        files={"file": ("chunk.wav", wav_data, "audio/wav")},
        data={"temperature": "0", "response-format": "json"},
        timeout=args.server_timeout,
    )
    response.raise_for_status()
    payload = response.json()
    return " ".join(str(payload.get("text", "")).split())


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


def default_whisper_server(no_gpu: bool) -> Path:
    if no_gpu:
        return Path("bin_cpu") / "Release" / "whisper-server.exe"
    return Path("bin_cuda") / "Release" / "whisper-server.exe"


def default_live_threads() -> int:
    logical_threads = max(1, os.cpu_count() or 1)
    if logical_threads <= 4:
        return logical_threads
    return 8


def free_local_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server_socket:
        server_socket.bind((host, 0))
        return int(server_socket.getsockname()[1])


def wait_for_port(host: str, port: int, process: Popen, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"whisper-server exited early with code {process.returncode}")
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError("Timed out waiting for whisper-server to start")


def stream_process_output(process: Popen, stop_event: Event) -> None:
    if process.stdout is None:
        return
    for line in process.stdout:
        if stop_event.is_set():
            break
        print(f"[whisper-server] {line.rstrip()}")


def start_whisper_server(args: Namespace) -> tuple[Popen, str, Event, Thread]:
    whisper_server = args.whisper_server or default_whisper_server(args.no_gpu)
    port = args.server_port or free_local_port(args.server_host)
    command = [
        str(whisper_server),
        "-m",
        str(args.model),
        "-l",
        args.language,
        "-t",
        str(args.threads),
        "-nt",
        "--host",
        args.server_host,
        "--port",
        str(port),
    ]
    if args.no_gpu:
        command.append("-ng")
    if args.openvino_device:
        command.extend(["-oved", args.openvino_device])
    if args.beam_size is not None:
        command.extend(["-bs", str(args.beam_size)])
    if args.best_of is not None:
        command.extend(["-bo", str(args.best_of)])
    if args.no_fallback:
        command.append("-nf")

    process = Popen(
        command,
        cwd=Path(__file__).resolve().parent,
        stdout=-1,
        stderr=-2,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    stop_event = Event()
    output_thread = Thread(target=stream_process_output, args=(process, stop_event), daemon=True)
    output_thread.start()
    wait_for_port(args.server_host, port, process)
    return process, f"http://{args.server_host}:{port}/inference", stop_event, output_thread


def stop_whisper_server(process: Popen | None, stop_event: Event | None, output_thread: Thread | None) -> None:
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5.0)
        except TimeoutExpired:
            process.kill()
    if stop_event:
        stop_event.set()
    if output_thread:
        output_thread.join(timeout=1.0)


def run_live(args: Namespace) -> None:
    args.threads = args.threads or default_live_threads()
    if args.server:
        args.max_backlog = min(args.max_backlog, 1)
    if args.save_recording:
        args.recording_output = args.recording_output or default_recording_path(args.recording_dir, args.session_prefix)
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
    print(f"Threads: {args.threads}")
    if args.server:
        print("Mode: whisper-server")
    print("Press Ctrl+C to stop.")

    chunks: Queue[np.ndarray] = Queue(maxsize=args.max_backlog)
    stop_event = Event()
    capture_thread = Thread(target=capture_audio, args=(args, chunks, stop_event), daemon=True)
    server_process = None
    server_output_stop = None
    server_output_thread = None

    try:
        if args.server:
            import requests

            server_process, server_url, server_output_stop, server_output_thread = start_whisper_server(args)
            print(f"Server: {server_url}")
            capture_thread.start()
            session = requests.Session()
            while True:
                mono = get_latest_chunk(chunks)
                chunk = resample_audio(mono, args.capture_rate, args.sample_rate)
                append_transcript(output_path, transcribe_with_server(args, session, server_url, chunk))
        else:
            capture_thread.start()
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
        stop_whisper_server(server_process, server_output_stop, server_output_thread)


def main() -> None:
    args = parse_args()
    try:
        run_live(args)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
