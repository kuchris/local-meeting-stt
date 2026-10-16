"""Speech-aware, revisable live captions shared by the Whisper backends.

The capture worker owns the WAV and sends consecutive PCM blocks here. Only the
unfinished utterance is re-transcribed for previews; a completed utterance is
transcribed once more before it is appended to the transcript file.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from queue import Empty, Queue
from threading import Event
from typing import Callable, Literal

import numpy as np


@dataclass(frozen=True)
class CaptionRequest:
    kind: Literal["partial", "final"]
    audio: np.ndarray


_HAN_OR_KANA = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LATIN = re.compile(r"[A-Za-z]")


def plausible_preview(text: str, language: str | None) -> bool:
    """Whether a preview is in the script of the language the user chose. Early in an
    utterance a recognizer guesses from a fraction of a second of audio, and a
    Cantonese sentence can come out as "So tiendin" before it settles."""
    if language in ("zh", "yue", "ja"):
        return bool(_HAN_OR_KANA.search(text))
    if language == "en":
        return bool(_LATIN.search(text))
    return True


class SpeechSegmenter:
    def __init__(
        self,
        sample_rate: int = 16000,
        preview_interval_seconds: float = 1.0,
        max_utterance_seconds: float = 20.0,
        vad: Callable[[np.ndarray], list[dict]] | None = None,
        min_preview_seconds: float = 0.4,
        split_after_seconds: float | None = 8.0,
        short_pause_vad: Callable[[np.ndarray], list[dict]] | None = None,
    ) -> None:
        if sample_rate != 16000:
            raise ValueError("Silero VAD live captions require 16 kHz audio")
        if preview_interval_seconds <= 0 or max_utterance_seconds <= 0:
            raise ValueError("Preview interval and utterance limit must be positive")
        if vad is None:
            from faster_whisper.vad import VadOptions, get_speech_timestamps

            options = VadOptions(
                threshold=0.5,
                min_speech_duration_ms=150,
                min_silence_duration_ms=500,
                speech_pad_ms=200,
            )
            vad = lambda audio: get_speech_timestamps(audio, options, sampling_rate=sample_rate)
            if short_pause_vad is None and split_after_seconds is not None:
                # Same detector, but a 250 ms gap counts as a pause: speakers who never
                # stop for half a second still breathe between phrases.
                short = VadOptions(threshold=0.5, min_speech_duration_ms=150, min_silence_duration_ms=250, speech_pad_ms=50)
                short_pause_vad = lambda audio: get_speech_timestamps(audio, short, sampling_rate=sample_rate)
        self.vad = vad
        self.short_pause_vad = short_pause_vad if split_after_seconds is not None else None
        self.split_after_samples = round((split_after_seconds or 0) * sample_rate)
        self.min_split_samples = round(2.0 * sample_rate)
        self.sample_rate = sample_rate
        self.preview_interval_samples = round(preview_interval_seconds * sample_rate)
        self.max_utterance_samples = round(max_utterance_seconds * sample_rate)
        self.min_preview_samples = round(min_preview_seconds * sample_rate)
        self.pre_roll_samples = round(0.3 * sample_rate)
        self.end_margin_samples = round(0.1 * sample_rate)
        self.pending = np.empty(0, dtype=np.float32)
        self.total_samples = 0
        self.last_preview_samples = 0

    def feed(self, block: np.ndarray) -> list[CaptionRequest]:
        if block.ndim != 1:
            raise ValueError("Expected mono PCM")
        if len(block) == 0:
            return []
        self.pending = np.concatenate((self.pending, block.astype(np.float32, copy=False)))
        self.total_samples += len(block)
        requests: list[CaptionRequest] = []

        while len(self.pending):
            spans = self.vad(self.pending)
            if not spans:
                self.pending = self.pending[-self.pre_roll_samples:]
                return requests
            first = spans[0]
            start = max(0, int(first["start"]))
            end = min(len(self.pending), int(first["end"]))
            complete = len(spans) > 1 or end + self.end_margin_samples < len(self.pending)
            if complete:
                requests.append(CaptionRequest("final", self.pending[start:end].copy()))
                self.pending = self.pending[end:]
                self.last_preview_samples = self.total_samples
                continue
            if len(self.pending) >= self.max_utterance_samples:
                requests.append(CaptionRequest("final", self.pending[start:].copy()))
                self.pending = np.empty(0, dtype=np.float32)
                self.last_preview_samples = self.total_samples
                return requests
            preview_due = self.total_samples - self.last_preview_samples >= self.preview_interval_samples
            # Checked when a preview is due, so the second VAD pass runs a few times a second at most.
            cut = self.short_pause_cut(start) if preview_due else None
            if cut is not None:
                requests.append(CaptionRequest("final", self.pending[start:cut].copy()))
                self.pending = self.pending[cut:]
                self.last_preview_samples = self.total_samples
                continue
            if preview_due and len(self.pending) - start >= self.min_preview_samples:
                requests.append(CaptionRequest("partial", self.pending[start:].copy()))
                self.last_preview_samples = self.total_samples
            return requests
        return requests

    def short_pause_cut(self, start: int) -> int | None:
        """Where to end a long unfinished utterance: the middle of its latest short
        pause, if that leaves at least 2 s to finalize. None until the utterance is
        longer than split_after_seconds."""
        if self.short_pause_vad is None or len(self.pending) - start < self.split_after_samples:
            return None
        spans = self.short_pause_vad(self.pending[start:])
        for before, after in zip(reversed(spans[:-1]), reversed(spans[1:])):
            cut = start + (int(before["end"]) + int(after["start"])) // 2
            if cut - start >= self.min_split_samples:
                return cut
        return None

    def finish(self) -> list[CaptionRequest]:
        spans = self.vad(self.pending) if len(self.pending) else []
        requests = [
            CaptionRequest("final", self.pending[int(span["start"]):int(span["end"])].copy())
            for span in spans
        ]
        self.pending = np.empty(0, dtype=np.float32)
        return requests


def run_streaming(
    chunks: Queue[np.ndarray],
    stop_event: Event,
    errors: list[Exception],
    capture_rate: int,
    sample_rate: int,
    output_path: Path,
    transcribe: Callable[[np.ndarray], str],
    resample: Callable[[np.ndarray, int, int], np.ndarray],
    preview_interval_seconds: float = 1.0,
    language: str | None = None,
    min_preview_seconds: float = 0.4,
    split_after_seconds: float | None = 8.0,
) -> None:
    segmenter = SpeechSegmenter(
        sample_rate, preview_interval_seconds, min_preview_seconds=min_preview_seconds, split_after_seconds=split_after_seconds,
    )
    last_partial = ""

    def process(request: CaptionRequest) -> None:
        nonlocal last_partial
        text = transcribe(request.audio).strip()
        if request.kind == "partial":
            # An empty preview (a breath, a word just begun) keeps the last one on screen.
            if text and text != last_partial and plausible_preview(text, language):
                print(f"@@PARTIAL\t{text}", flush=True)
                last_partial = text
            return
        if text:
            timestamp = datetime.now().strftime("%H:%M:%S")
            with output_path.open("a", encoding="utf-8") as handle:
                handle.write(f"[{timestamp}] {text}\n")
            print(f"@@FINAL\t{text}", flush=True)
        elif last_partial:
            print("@@PARTIAL\t", flush=True)
        last_partial = ""

    while True:
        if errors:
            raise RuntimeError(f"Audio capture failed: {errors[0]}") from errors[0]
        try:
            block = chunks.get(timeout=0.1)
        except Empty:
            if stop_event.is_set():
                break
            continue
        # Keep every audio block, but skip previews made stale while inference ran.
        blocks = [block]
        while True:
            try:
                blocks.append(chunks.get_nowait())
            except Empty:
                break
        # One VAD pass over everything that arrived: VAD reads the whole pending
        # utterance, so running it per 0.1 s block would cost ten passes a second.
        audio = np.concatenate([resample(item, capture_rate, sample_rate) for item in blocks])
        latest_partial = None
        for request in segmenter.feed(audio):
            if request.kind == "final":
                latest_partial = None
                process(request)
            else:
                latest_partial = request
        if latest_partial is not None and not stop_event.is_set():
            process(latest_partial)
    if errors:
        raise RuntimeError(f"Audio capture failed: {errors[0]}") from errors[0]
    for request in segmenter.finish():
        process(request)
