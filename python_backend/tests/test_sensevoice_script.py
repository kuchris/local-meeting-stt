from argparse import Namespace
from pathlib import Path
import sys
import types
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from live_transcribe import sensevoice_transcriber


class FakeRecognizer:
    """Stands in for sherpa-onnx: returns the next (text, language tag) for each decode."""

    replies: list[tuple[str, str]] = []

    @classmethod
    def from_sense_voice(cls, **_):
        return cls()

    def create_stream(self):
        return types.SimpleNamespace(accept_waveform=lambda rate, audio: None, result=None)

    def decode_stream(self, stream):
        text, lang = self.replies.pop(0)
        stream.result = types.SimpleNamespace(text=text, lang=lang)


class SenseVoiceScriptTests(unittest.TestCase):
    def setUp(self):
        sys.modules["sherpa_onnx"] = types.SimpleNamespace(OfflineRecognizer=FakeRecognizer)
        self.args = Namespace(provider="cpu", sensevoice_model=Path("models"), threads=1, sample_rate=16000, language="auto")

    def test_auto_detect_keeps_japanese_kanji_and_converts_chinese(self):
        FakeRecognizer.replies = [("会議", "<|ja|>"), ("会议", "<|zh|>")]
        transcribe = sensevoice_transcriber(self.args, "auto", "traditional")
        audio = np.zeros(1600, dtype=np.float32)
        self.assertEqual(transcribe(audio), "会議")
        self.assertEqual(transcribe(audio), "會議")


if __name__ == "__main__":
    unittest.main()
