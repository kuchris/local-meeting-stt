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
from text_script import SCRIPTS, with_script

# Languages the app offers; "auto" lets the model detect each utterance's language.
LANGUAGES = ("auto", "zh", "yue", "en", "ja")


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Record system audio in short chunks and append a rough live transcript.")
    parser.add_argument("--output", type=Path, help="Transcript output path")
    parser.add_argument("--save-recording", action="store_true", help="Also save the captured meeting audio to a WAV file")
    parser.add_argument("--recording-output", type=Path, help="Recording output path when --save-recording is set")
    parser.add_argument("--recording-dir", type=Path, default=Path("recordings"), help="Directory for timestamped live recordings")
    parser.add_argument("--engine", choices=("faster-whisper", "sensevoice"), default="faster-whisper", help="Recognizer. Default: faster-whisper")
    parser.add_argument("--model", default="small", help="faster-whisper model name. Default: small")
    parser.add_argument("--sensevoice-model", type=Path, default=Path("models") / "SenseVoiceSmall", help="sherpa-onnx SenseVoice model folder")
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu", help="SenseVoice ONNX Runtime provider. Default: cpu")
    parser.add_argument("--threads", type=int, default=4, help="SenseVoice CPU threads. Default: 4")
    parser.add_argument("--language", default="ja", help="auto, zh, yue, en or ja (empty also means auto). Default: ja")
    parser.add_argument("--chinese-script", choices=SCRIPTS, default="as-is", help="Convert Chinese captions to Traditional (HK) or Simplified. Default: as-is")
    parser.add_argument("--session-prefix", default="live_meeting", help="Prefix for timestamped session folders. Default: live_meeting")
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


def default_recording_path(output_dir: Path, prefix: str = "live_meeting") -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_dir / f"{prefix}_{stamp}" / "audio.wav"


def default_transcript_path(recording_path: Path | None) -> Path:
    if recording_path:
        return recording_path.with_name("live_transcript.txt")
    return Path("live_transcript.txt")


def transcribe_file(model: WhisperModel, audio_path: Path, language: str | None) -> str:
    segments, _ = model.transcribe(str(audio_path), language=language, beam_size=1, vad_filter=True)
    lines = [segment.text.strip() for segment in segments if segment.text.strip()]
    return " ".join(lines).strip()


def sensevoice_transcriber(args: Namespace, language: str):
    """SenseVoice-Small through sherpa-onnx: int8 on CPU, fp32 on CUDA."""
    if args.provider == "cuda":
        import cuda_dlls  # noqa: F401  (CUDA 12 / cuDNN 9 DLLs from NVIDIA's pip packages)
    import sherpa_onnx

    folder = args.sensevoice_model
    model_file = folder / ("model.onnx" if args.provider == "cuda" else "model.int8.onnx")
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model_file), tokens=str(folder / "tokens.txt"), num_threads=args.threads,
        use_itn=True, language=language, provider=args.provider,
    )

    def transcribe(audio: np.ndarray) -> str:
        stream = recognizer.create_stream()
        stream.accept_waveform(args.sample_rate, audio)
        recognizer.decode_stream(stream)
        return stream.result.text.strip()

    return transcribe


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
    if args.language not in ("",) + LANGUAGES:
        raise SystemExit(f"Unsupported language: {args.language}")
    if args.engine == "sensevoice" and not args.streaming:
        raise SystemExit("SenseVoice runs only with --streaming")
    if args.save_recording:
        args.recording_output = args.recording_output or default_recording_path(args.recording_dir, args.session_prefix)
    if args.recording_output:
        args.recording_output.parent.mkdir(parents=True, exist_ok=True)
    output_path = args.output or default_transcript_path(args.recording_output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    language = None if args.language in ("", "auto") else args.language
    system_device = select_system_loopback(args.system_device)
    mic_device = select_microphone(args.mic_device) if args.include_mic else None

    print(f"System loopback: {system_device.name}")
    if mic_device:
        print(f"Microphone: {mic_device.name}")
    print(f"Transcript: {output_path}")
    if args.recording_output:
        print(f"Recording: {args.recording_output}")
    print("Press Ctrl+C to stop.")

    print(f"Language: {args.language or 'auto'}")
    if args.engine == "sensevoice":
        print(f"Model: SenseVoice-Small ({args.provider}) {args.sensevoice_model}")
        transcribe_stream = with_script(sensevoice_transcriber(args, language or "auto"), args.chinese_script, args.language)
    else:
        model_name_or_path = resolve_whisper_model(args.model)
        print(f"Model: {model_name_or_path}")
        model = WhisperModel(model_name_or_path, device=args.device, compute_type=args.compute_type)

        def transcribe_whisper(audio: np.ndarray) -> str:
            segments, _ = model.transcribe(
                audio, language=language, beam_size=1, temperature=0,
                condition_on_previous_text=False, vad_filter=False,
            )
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()

        transcribe_stream = with_script(transcribe_whisper, args.chinese_script, args.language)
    chunks: Queue[np.ndarray] = Queue(maxsize=0 if args.streaming else args.max_backlog)
    stop_event = Event()
    watch_stop_request(stop_event)
    capture_errors: list[Exception] = []
    capture_thread = Thread(target=capture_worker, args=(capture_audio, args, chunks, stop_event, capture_errors), daemon=True)
    capture_thread.start()
    print("Ready: model loaded; audio capture started.")

    try:
        if args.streaming:
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
