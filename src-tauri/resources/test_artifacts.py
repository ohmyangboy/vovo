import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from artifacts import safe_name, write_artifacts

AUDIO_AVAILABLE = all(importlib.util.find_spec(name) for name in ("numpy", "soundfile", "lameenc"))


@unittest.skipUnless(AUDIO_AVAILABLE, "需要 numpy、soundfile、lameenc；可通过 uv run --with 安装测试依赖")
class ArtifactTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.samples = (.1 * np.sin(np.arange(24000, dtype=np.float32) * .04)).astype(np.float32)

    def test_audio_and_subtitles_share_final_timeline(self):
        result = write_artifacts(self.root, "稿件", self.samples, 24000, [(0, .8, "完整文字")], "完整文字")
        for key in ("mp3", "wav", "srt", "txt", "captions"):
            self.assertGreater(Path(result[key]).stat().st_size, 0)
        with wave.open(result["wav"]) as audio:
            self.assertEqual(audio.getframerate(), 24000)
            self.assertEqual(audio.getnframes(), 24000)
        self.assertEqual(result["duration"], 1)
        self.assertEqual(json.loads(Path(result["captions"]).read_text()), [dict(start=0, end=.8, text="完整文字")])

    def test_second_version_never_overwrites_first(self):
        first = write_artifacts(self.root, "同名", self.samples, 24000, [(0, .8, "第一版")], "第一版")
        second = write_artifacts(self.root, "同名", self.samples, 24000, [(0, .8, "第二版")], "第二版")
        self.assertNotEqual(first["mp3"], second["mp3"])
        self.assertEqual(Path(first["txt"]).read_text(), "第一版")
        self.assertEqual(Path(second["txt"]).read_text(), "第二版")

    def test_encoding_failure_removes_unpublished_files(self):
        with patch("artifacts.write_mp3", side_effect=RuntimeError("编码失败")):
            with self.assertRaises(RuntimeError):
                write_artifacts(self.root, "失败", self.samples, 24000, [(0, .8, "文字")], "文字")
        self.assertEqual(list(self.root.iterdir()), [])

    def test_bad_audio_or_timeline_never_publishes_files(self):
        import numpy as np
        cases = [(np.array([]), [(0, 1, "空")]), (np.array([float("nan")]), [(0, 1, "异常")]),
                 (self.samples, [(0, 2, "超时")]), (self.samples, [(-.1, .8, "负数")]),
                 (self.samples, [(0, .7, "一"), (.6, .9, "二")])]
        for samples, captions in cases:
            with self.assertRaises(ValueError):
                write_artifacts(self.root, "无效", samples, 24000, captions, "文字")
        self.assertEqual(list(self.root.iterdir()), [])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "需要 FFmpeg")
    def test_ffmpeg_clone_encoder_uses_the_same_bundle_contract(self):
        result = write_artifacts(self.root, "克隆", self.samples, 24000, [(0, .8, "文字")], "文字", shutil.which("ffmpeg"))
        output = subprocess.check_output([shutil.which("ffprobe"), "-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "json", result["mp3"]])
        stream = json.loads(output)["streams"][0]
        self.assertEqual(stream["sample_rate"], "24000")
        self.assertEqual(stream["channels"], 1)


class FileNameTests(unittest.TestCase):
    def test_output_names_cannot_escape_directory(self):
        self.assertNotIn("/", safe_name("../../私有:稿件"))
        self.assertNotIn("\\", safe_name("..\\私有"))
        self.assertEqual(safe_name("..."), "配音")
        self.assertEqual(safe_name("CON.txt"), "_CON.txt")
        self.assertLessEqual(len(safe_name("🎙" * 100).encode("utf-8")), 180)


if __name__ == "__main__":
    unittest.main()
