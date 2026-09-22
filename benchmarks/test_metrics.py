import unittest

from metrics import edit_distance, normalize_text, replay_timing, score


class MetricTests(unittest.TestCase):
    def test_japanese_normalization_keeps_content(self):
        self.assertEqual(normalize_text("ＡＩ、会議。 １２３\n"), "ai会議123")
        self.assertNotEqual(normalize_text("二人"), normalize_text("2人"))

    def test_substitution_deletion_and_insertion(self):
        self.assertEqual(edit_distance("kitten", "sitting"), 3)
        self.assertEqual(score("今日は晴れ", "今日は雨")['errors'], 2)
        self.assertEqual(score("あ", "あいう")['cer'], 2)

    def test_silence_does_not_produce_a_fake_zero_cer(self):
        self.assertIsNone(score("", "幻覚")['cer'])
        self.assertEqual(score("", "幻覚")['errors'], 2)

    def test_replay_accumulates_backlog(self):
        first = replay_timing(0, 3, 4)
        second = replay_timing(first['finish'], 6, 4)
        self.assertEqual(first['finish'], 7)
        self.assertEqual(second['queue_seconds'], 1)
        self.assertEqual(second['lag_seconds'], 5)

    def test_fast_replay_waits_for_future_audio(self):
        self.assertEqual(replay_timing(3.2, 6, .2)['queue_seconds'], 0)


if __name__ == '__main__':
    unittest.main()
