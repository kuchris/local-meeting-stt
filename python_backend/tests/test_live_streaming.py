from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from live_streaming import SpeechSegmenter, plausible_preview


def fake_vad(audio: np.ndarray) -> list[dict]:
    voiced = np.flatnonzero(audio > 0.5)
    if len(voiced) == 0:
        return []
    start, last = int(voiced[0]), int(voiced[-1]) + 1
    end = last if len(audio) - last >= 8000 else len(audio)
    return [{"start": start, "end": end}]


class LiveStreamingTests(unittest.TestCase):
    def test_preview_is_replaced_and_sentence_is_finalized_once(self):
        segmenter = SpeechSegmenter(vad=fake_vad)
        silence = np.zeros(8000, dtype=np.float32)
        speech = np.ones(8000, dtype=np.float32)
        self.assertEqual(segmenter.feed(silence), [])
        preview = segmenter.feed(speech)
        self.assertEqual([item.kind for item in preview], ["partial"])
        self.assertEqual(len(preview[0].audio), 8000)
        self.assertEqual(segmenter.feed(speech), [])
        completed = segmenter.feed(silence)
        self.assertEqual([item.kind for item in completed], ["final"])
        self.assertEqual(len(completed[0].audio), 16000)
        self.assertEqual(segmenter.feed(silence), [])
        self.assertEqual(segmenter.finish(), [])

    def test_stop_finalizes_unfinished_speech(self):
        segmenter = SpeechSegmenter(vad=fake_vad)
        speech = np.ones(8000, dtype=np.float32)
        segmenter.feed(speech)
        final = segmenter.finish()
        self.assertEqual([item.kind for item in final], ["final"])
        self.assertEqual(len(final[0].audio), len(speech))
        self.assertEqual(segmenter.finish(), [])

    def test_long_utterance_is_bounded(self):
        segmenter = SpeechSegmenter(max_utterance_seconds=2, vad=fake_vad)
        speech = np.ones(8000, dtype=np.float32)
        requests = [item for _ in range(4) for item in segmenter.feed(speech)]
        self.assertEqual([item.kind for item in requests], ["partial", "final"])
        self.assertEqual(len(requests[-1].audio), 32000)

    def test_first_preview_waits_for_enough_speech(self):
        segmenter = SpeechSegmenter(vad=fake_vad, min_preview_seconds=0.8)
        speech = np.ones(8000, dtype=np.float32)
        self.assertEqual(segmenter.feed(speech), [])
        self.assertEqual([item.kind for item in segmenter.feed(speech)], ["partial"])

    def test_previews_in_another_script_are_dropped(self):
        self.assertFalse(plausible_preview("So tiendin", "yue"))
        self.assertTrue(plausible_preview("在短短兩週內", "yue"))
        self.assertTrue(plausible_preview("今日は", "ja"))
        self.assertFalse(plausible_preview("你好", "en"))
        self.assertTrue(plausible_preview("So tiendin", "auto"))


if __name__ == "__main__":
    unittest.main()
