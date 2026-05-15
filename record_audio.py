from __future__ import annotations

from argparse import ArgumentParser, Namespace
from datetime import datetime
from pathlib import Path
from threading import Event, Thread
from time import perf_counter

import numpy as np
import soundcard as sc
import soundfile as sf
import soxr


def parse_args() -> Namespace:
    parser = ArgumentParser(description="Record Windows system audio loopback to a mono 16 kHz WAV file.")
    parser.add_argument("--duration", type=float, default=3600.0, help="Recording duration in seconds. Default: 3600")
    parser.add_argument("--until-enter", action="store_true", help="Record until Enter is pressed")
    parser.add_argument("--output", type=Path, help="Output WAV path. Default: recordings/meeting_<timestamp>.wav")
    parser.add_argument("--output-dir", type=Path, default=Path("recordings"), help="Directory for timestamped recordings")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Output sample rate. Default: 16000")
    parser.add_argument("--capture-rate", type=int, default=48000, help="Capture sample rate. Default: 48000")
    parser.add_argument("--chunk-seconds", type=float, default=1.0, help="Capture chunk size in seconds. Default: 1")
    parser.add_argument("--include-mic", action="store_true", help="Also record the default microphone and mix it in")
    parser.add_argument("--system-device", help="Substring or id of the loopback device to record")
    parser.add_argument("--mic-device", help="Substring or id of the microphone to record when --include-mic is set")
    parser.add_argument("--list-devices", action="store_true", help="List available recording devices and exit")
    return parser.parse_args()


def timestamped_output_path(output_dir: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_dir / f"meeting_{stamp}.wav"


def list_devices() -> None:
    print(f"Default speaker: {sc.default_speaker().name}")
    print(f"Default microphone: {sc.default_microphone().name}")
    print()
    print("Recording devices:")
    for index, mic in enumerate(sc.all_microphones(include_loopback=True)):
        kind = "loopback" if mic.isloopback else "mic"
        print(f"{index:2d} [{kind}] {mic.name}")
        print(f"    id: {mic.id}")


def find_device(name_or_id: str, *, want_loopback: bool | None):
    query = name_or_id.casefold()
    candidates = sc.all_microphones(include_loopback=True)
    matches = [
        device
        for device in candidates
        if (want_loopback is None or device.isloopback == want_loopback)
        and (query in device.name.casefold() or query in str(device.id).casefold())
    ]
    if not matches:
        kind = "loopback" if want_loopback else "microphone" if want_loopback is False else "recording"
        raise SystemExit(f"No matching {kind} device found for: {name_or_id}")
    return matches[0]


def select_system_loopback(device_query: str | None):
    if device_query:
        return find_device(device_query, want_loopback=True)

    default_speaker_name = sc.default_speaker().name
    loopbacks = [device for device in sc.all_microphones(include_loopback=True) if device.isloopback]
    for device in loopbacks:
        if device.name == default_speaker_name:
            return device
    for device in loopbacks:
        if default_speaker_name.casefold() in device.name.casefold() or device.name.casefold() in default_speaker_name.casefold():
            return device
    if not loopbacks:
        raise SystemExit("No Windows loopback recording devices were found.")
    return loopbacks[0]


def select_microphone(device_query: str | None):
    if device_query:
        return find_device(device_query, want_loopback=False)

    default_mic = sc.default_microphone()
    if not default_mic.isloopback:
        return default_mic

    mics = [device for device in sc.all_microphones(include_loopback=True) if not device.isloopback]
    if not mics:
        raise SystemExit("No physical/virtual microphone devices were found.")
    return mics[0]


def to_mono(samples: np.ndarray) -> np.ndarray:
    if samples.ndim == 1:
        return samples.astype(np.float32, copy=False)
    return samples.mean(axis=1).astype(np.float32, copy=False)


def normalize_length(left: np.ndarray, right: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    frame_count = min(len(left), len(right))
    return left[:frame_count], right[:frame_count]


def mix_audio(system_samples: np.ndarray, mic_samples: np.ndarray | None) -> np.ndarray:
    mono = to_mono(system_samples)
    if mic_samples is not None:
        mic_mono = to_mono(mic_samples)
        mono, mic_mono = normalize_length(mono, mic_mono)
        mono = (mono + mic_mono) * 0.5
    return np.clip(mono, -1.0, 1.0)


def resample_audio(samples: np.ndarray, input_rate: int, output_rate: int) -> np.ndarray:
    if input_rate == output_rate:
        return samples
    return soxr.resample(samples, input_rate, output_rate).astype(np.float32, copy=False)


def wait_for_enter(stop_event: Event) -> None:
    input()
    stop_event.set()


def record_audio(args: Namespace) -> Path:
    output_path = args.output or timestamped_output_path(args.output_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    system_device = select_system_loopback(args.system_device)
    mic_device = select_microphone(args.mic_device) if args.include_mic else None

    print(f"System loopback: {system_device.name}")
    if mic_device:
        print(f"Microphone: {mic_device.name}")
    print(f"Writing: {output_path}")

    stop_event = Event()
    if args.until_enter:
        print("Press Enter to stop recording.")
        Thread(target=wait_for_enter, args=(stop_event,), daemon=True).start()

    chunk_frames = max(1, int(args.capture_rate * args.chunk_seconds))
    total_frames = None if args.until_enter else max(1, int(args.capture_rate * args.duration))
    recorded_frames = 0
    started = perf_counter()

    try:
        with sf.SoundFile(output_path, mode="w", samplerate=args.sample_rate, channels=1, subtype="PCM_16") as wav:
            with system_device.recorder(samplerate=args.capture_rate) as system_recorder:
                if mic_device is None:
                    while not stop_event.is_set() and (total_frames is None or recorded_frames < total_frames):
                        frames = chunk_frames if total_frames is None else min(chunk_frames, total_frames - recorded_frames)
                        system_chunk = system_recorder.record(numframes=frames)
                        mono = mix_audio(system_chunk, None)
                        wav.write(resample_audio(mono, args.capture_rate, args.sample_rate))
                        recorded_frames += frames
                else:
                    with mic_device.recorder(samplerate=args.capture_rate) as mic_recorder:
                        while not stop_event.is_set() and (total_frames is None or recorded_frames < total_frames):
                            frames = chunk_frames if total_frames is None else min(chunk_frames, total_frames - recorded_frames)
                            system_chunk = system_recorder.record(numframes=frames)
                            mic_chunk = mic_recorder.record(numframes=frames)
                            mono = mix_audio(system_chunk, mic_chunk)
                            wav.write(resample_audio(mono, args.capture_rate, args.sample_rate))
                            recorded_frames += frames
    except KeyboardInterrupt:
        print("\nStopped by Ctrl+C.")

    elapsed = perf_counter() - started
    print(f"Saved: {output_path} ({elapsed:.1f}s)")
    return output_path


def main() -> None:
    args = parse_args()
    if args.list_devices:
        list_devices()
        return
    record_audio(args)


if __name__ == "__main__":
    main()
