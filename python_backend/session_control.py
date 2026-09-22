"""Cooperative cancellation shared by capture workers and the desktop host."""
from __future__ import annotations

import os
from pathlib import Path
from queue import Empty
from threading import Event, Thread


def watch_stop_request(stop: Event) -> None:
    filename = os.environ.get("LOCAL_MEETING_STT_STOP_FILE")
    if not filename:
        return

    def watch() -> None:
        while not stop.is_set():
            if Path(filename).exists():
                stop.set()
                return
            stop.wait(0.1)

    Thread(target=watch, daemon=True).start()


def capture_worker(target, args, chunks, stop: Event, errors: list[Exception]) -> None:
    try:
        target(args, chunks, stop)
    except Exception as exc:
        errors.append(exc)
    finally:
        stop.set()


def next_chunk(chunks, stop: Event, errors: list[Exception]):
    """Wait without deadlocking when a device fails or the user stops capture."""
    while not stop.is_set():
        if errors:
            raise RuntimeError(f"Audio capture failed: {errors[0]}") from errors[0]
        try:
            return chunks.get(timeout=0.1)
        except Empty:
            pass
    if errors:
        raise RuntimeError(f"Audio capture failed: {errors[0]}") from errors[0]
    return None
