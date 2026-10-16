from argparse import Namespace
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "whisper_cpp"))
from live_cpp import stream_transcriber, transcribe_with_server


class FakeResponse:
    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"text": " 群島や湖では "}


class FakeSession:
    def __init__(self) -> None:
        self.posts = 0

    def post(self, url, files, data, timeout):
        self.posts += 1
        return FakeResponse()


def tone(rms: float) -> np.ndarray:
    wave = np.sin(np.arange(16000) * 2 * np.pi * 220 / 16000).astype(np.float32)
    return wave * (rms * np.sqrt(2))


ARGS = Namespace(silence_rms=0.003, sample_rate=16000, server_timeout=5.0)
URL = "http://127.0.0.1:1/inference"


class QuietSpeechTests(unittest.TestCase):
    def test_quiet_vad_utterance_is_recognized(self):
        # FLEURS ja_jp test sample 1731's speech has RMS 0.0012; it was dropped whole.
        session = FakeSession()
        self.assertEqual(stream_transcriber(ARGS, session, URL)(tone(0.0012)), "群島や湖では")
        self.assertEqual(session.posts, 1)

    def test_quiet_fixed_chunk_is_still_skipped(self):
        session = FakeSession()
        self.assertEqual(transcribe_with_server(ARGS, session, URL, tone(0.0012)), "")
        self.assertEqual(session.posts, 0)

    def test_audible_fixed_chunk_is_sent(self):
        session = FakeSession()
        self.assertEqual(transcribe_with_server(ARGS, session, URL, tone(0.05)), "群島や湖では")
        self.assertEqual(session.posts, 1)


if __name__ == "__main__":
    unittest.main()
