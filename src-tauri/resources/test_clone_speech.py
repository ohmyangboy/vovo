import tempfile
import unittest
import shutil

from clone_speech import change_tempo, language_for, pick_reference, speech_items


class PhrasingTests(unittest.TestCase):
    def test_english_sentence_is_not_cut_at_ninety_characters(self):
        text = "Over two years ago, we wrote a detailed deconstruction of this idea and argued that its primary effect was to turn vague fears into seemingly precise numbers."
        self.assertEqual(speech_items(text), [(text, 0)])
        self.assertEqual(language_for(text), "english")
        self.assertEqual(language_for("你好，世界。"), "chinese")
        self.assertEqual(language_for("你好，hello。"), "auto")

    def test_long_clauses_have_no_artificial_pause(self):
        text = " ".join(["a long English clause"] * 30) + "."
        items = speech_items(text)
        self.assertGreater(len(items), 1)
        self.assertTrue(all(len(sentence) <= 320 for sentence, _ in items))
        self.assertTrue(all(pause == 0 for _, pause in items))
        self.assertEqual(" ".join(sentence for sentence, _ in items), text)

    def test_abbreviations_paragraphs_and_explicit_pauses(self):
        items = speech_items("Dr. Smith paid 19.99 dollars. Next sentence.\n\nAfter a pause【停顿:2秒】continue speaking.")
        self.assertEqual(items[0], ("Dr. Smith paid 19.99 dollars.", .06))
        self.assertEqual(items[1][1], .22)
        self.assertEqual(items[2][1], 2)
        self.assertEqual(items[-1][1], 0)
        self.assertEqual(speech_items("Hello【停顿:2秒】")[-1][1], 2)
        self.assertEqual(speech_items("Hello【停顿:2秒】there.")[-1][1], 0)
        with self.assertRaises(ValueError):
            speech_items("Hello【停顿:100秒】")

    def test_language_matched_reference_and_primary_fallback(self):
        refs = [dict(reference="zh.wav", refText="我的参考录音。"),
                dict(reference="en.wav", refText="This is my English reference.")]
        self.assertEqual(pick_reference("A complete English sentence.", refs)["reference"], "en.wav")
        self.assertEqual(pick_reference("中文文稿。", refs)["reference"], "zh.wav")
        self.assertEqual(pick_reference("中文 with English", refs)["reference"], "zh.wav")
        self.assertEqual(pick_reference("English only", refs[:1])["reference"], "zh.wav")
        refs.append(dict(reference="new-english.wav", refText="A new English recording."))
        self.assertEqual(pick_reference("English only", refs)["reference"], "new-english.wav")


class TempoTests(unittest.TestCase):
    def test_export_duration_pitch_and_captions_change_together(self):
        import numpy as np
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            self.skipTest("FFmpeg is required for the real audio tempo check")
        rate = 24000
        samples = np.sin(np.arange(rate * 6) * (2 * np.pi * 440 / rate)).astype("float32") * .2
        captions = [(0, 3, "First."), (3, 6, "Second.")]
        with tempfile.TemporaryDirectory() as work:
            adjusted, timeline = change_tempo(samples, rate, captions, 1.2, work, ffmpeg)
        self.assertAlmostEqual(len(adjusted) / rate, 5, delta=.08)
        peak = np.fft.rfftfreq(len(adjusted), 1 / rate)[np.argmax(np.abs(np.fft.rfft(adjusted)))]
        self.assertAlmostEqual(peak, 440, delta=3)
        self.assertAlmostEqual(timeline[-1][1], len(adjusted) / rate)
        self.assertEqual(timeline[0][2], "First.")

    def test_default_speed_and_invalid_values(self):
        samples, captions = [1, 2], [(0, 1, "Hello")]
        same, timeline = change_tempo(samples, 24000, captions, 1, "unused", "unused")
        self.assertIs(same, samples)
        self.assertIs(timeline, captions)
        for speed in (0, 1.5, float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                change_tempo(samples, 24000, captions, speed, "unused", "unused")
