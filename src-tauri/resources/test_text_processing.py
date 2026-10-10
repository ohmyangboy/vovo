import tempfile
import unittest
from pathlib import Path

from text_processing import caption_text, clean_marks, fmt_ts, prepare_items, split_sentences, write_srt


class TextProcessingTests(unittest.TestCase):
    def test_decimals_do_not_create_fake_sentences(self):
        self.assertEqual(split_sentences("购买价 19.99 元。版本 1.5 已发布。"), ["购买价 19.99 元。", "版本 1.5 已发布。"])

    def test_brackets_are_content_not_generic_stage_directions(self):
        self.assertEqual(clean_marks("请保留【重要条款】和[产品名称]。"), "请保留【重要条款】和[产品名称]。")

    def test_long_unpunctuated_text_is_bounded_without_data_loss(self):
        text = "长" * 600
        parts = split_sentences(text, max_len=260)
        self.assertEqual("".join(parts), text)
        self.assertEqual([len(p) for p in parts], [260, 260, 80])

    def test_abbreviations_and_urls_stay_intact(self):
        self.assertEqual(split_sentences("Dr. Smith paid 19.99 dollars. Visit https://example.com/a.b. Thanks!"),
                         ["Dr. Smith paid 19.99 dollars.", "Visit https://example.com/a.b.", "Thanks!"])

    def test_pause_tokens_keep_text_and_requested_time(self):
        self.assertEqual(prepare_items(["第一句。【停顿:2秒】第二句。"]), [("第一句。", 2.0), ("第二句。", .6)])
        self.assertEqual(prepare_items(["[pause:1]你好。"]), [("", 1.0), ("你好。", .6)])
        self.assertEqual(prepare_items(["[pause:1][pause:2]你好。"]), [("", 1.0), ("", 2.0), ("你好。", .6)])
        with self.assertRaises(ValueError):
            prepare_items(["不允许。[pause:99]"])

    def test_rollover_and_invalid_timestamps(self):
        self.assertEqual(fmt_ts(59.9999), "00:01:00,000")
        for value in [-1, float("inf"), float("nan")]:
            with self.assertRaises(ValueError):
                fmt_ts(value)

    def test_srt_rejects_overlap_and_negative_timeline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.srt"
            write_srt(path, [(0.0, 1.0, "第一句"), (1.3, 2.0, "第二句")])
            self.assertIn("00:00:01,300 --> 00:00:02,000", path.read_text())
            for entries in [[(-.0001, 1, "负数")], [(0, 1, "一"), (.9, 2, "二")], [(0, 1, "")]]:
                with self.assertRaises(ValueError):
                    write_srt(path, entries)

    def test_caption_wrap_is_readable(self):
        self.assertIn("\n", caption_text("这是一段需要换行显示的中文配音字幕文字，请在试听后认真核对。"))
        self.assertEqual(caption_text("短句。"), "短句。")
        self.assertEqual(caption_text("第一行\n第二行"), "第一行\n第二行")


if __name__ == "__main__":
    unittest.main()
