"""Signal-boundary checks for the native streaming benchmark (CPU only)."""
import unittest
from types import SimpleNamespace

import numpy as np
import torch
from transformers import AutoProcessor

from prepare_nemotron import MODEL_DIR
from run_nemotron import Nemotron, chunk_plan


class StreamingBoundaries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
        torch.set_num_threads(2)

    def test_features_match_whole_signal_without_dropping_tail(self):
        rng = np.random.default_rng(5)
        for right in (0, 3):
            self.processor.set_num_lookahead_tokens(right)
            engine = Nemotron.__new__(Nemotron)
            engine.processor = self.processor
            engine.model = SimpleNamespace(device="cpu", dtype=torch.float32)
            for length in (63, 256, 1280, 15999, 17031):
                with self.subTest(right=right, length=length):
                    audio = rng.standard_normal(length).astype(np.float32) * .1
                    plans = list(chunk_plan(length, self.processor.num_mel_frames_first_audio_chunk,
                                            self.processor.num_mel_frames_per_audio_chunk))
                    full = np.pad(audio, (0, max(0, plans[-1]["end"] - length)))
                    expected = self.processor(full, sampling_rate=16000, language="ja-JP").input_features
                    actual = torch.cat([engine.features(audio, p) for p in plans], dim=1)
                    torch.testing.assert_close(actual, expected[:, :actual.shape[1]], atol=1e-5, rtol=1e-5)
                    self.assertEqual(plans[-1]["available_samples"], length)
                    self.assertGreaterEqual(actual.shape[1], max(1, length // 160))
                    self.assertEqual([p["available_samples"] for p in plans],
                                     sorted(p["available_samples"] for p in plans))

    def test_unarrived_audio_cannot_change_features(self):
        self.processor.set_num_lookahead_tokens(3)
        engine = Nemotron.__new__(Nemotron)
        engine.processor = self.processor
        engine.model = SimpleNamespace(device="cpu", dtype=torch.float32)
        audio = np.random.default_rng(7).standard_normal(16000).astype(np.float32)
        plan = next(chunk_plan(len(audio), 25, 32))
        before = engine.features(audio, plan)
        audio[plan["available_samples"]:] = 9000
        torch.testing.assert_close(before, engine.features(audio, plan), rtol=0, atol=0)

    def test_pinned_checkpoint_rejects_160ms(self):
        with self.assertRaises(ValueError):
            self.processor.set_num_lookahead_tokens(1)


if __name__ == "__main__":
    unittest.main()
