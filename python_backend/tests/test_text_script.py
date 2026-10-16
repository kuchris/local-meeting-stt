from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from text_script import convert_lines


class TextScriptTests(unittest.TestCase):
    def test_transcript_lines_with_kana_are_kept(self):
        text = "这是一个会议\n今日は会議です\n下个月再说"
        self.assertEqual(convert_lines(text, "traditional"), "這是一個會議\n今日は会議です\n下個月再説")

    def test_japanese_transcript_is_not_converted(self):
        self.assertEqual(convert_lines("会議\n東京", "traditional", "ja"), "会議\n東京")

    def test_as_is_leaves_text_alone(self):
        self.assertEqual(convert_lines("这是", "as-is"), "这是")


if __name__ == "__main__":
    unittest.main()
