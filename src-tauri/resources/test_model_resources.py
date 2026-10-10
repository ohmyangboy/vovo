import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

import engine


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.models = root / "models"
        self.patcher = patch.multiple(engine, MODEL_ROOT=self.models, HF_HUB=root / "empty-cache", SAMPLE_ROOT=root / "samples")
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.model = self.models / "en"
        (self.model / "voices").mkdir(parents=True)
        (self.model / "config.json").write_text("{}")
        (self.model / engine.MODELS["en"]["weight"]).write_bytes(b"weights")

    def complete(self):
        files = {str(file.relative_to(self.model)): file.stat().st_size for file in self.model.rglob("*")
                 if file.is_file() and file.name != ".complete.json"}
        (self.model / ".complete.json").write_text(json.dumps({"revision": engine.MODELS["en"]["revision"], "files": files}))

    def test_cancelled_download_is_not_marked_ready(self):
        self.assertIsNone(engine.model_directory("en"))

    def test_full_model_requires_supported_voice_files(self):
        (self.model / "voices/af_heart.pt").write_bytes(b"voice")
        self.complete()
        self.assertTrue(engine.voice_ready("en", "af_heart"))
        self.assertFalse(engine.model_installed("en"))
        for _, voices in engine.VOICE_GROUPS["en"]:
            for voice, _ in voices:
                if voice[0] in "ab":
                    (self.model / "voices" / f"{voice}.pt").write_bytes(b"voice")
        self.complete()
        self.assertTrue(engine.model_installed("en"))

    def test_changed_download_file_fails_integrity_check(self):
        self.complete()
        (self.model / engine.MODELS["en"]["weight"]).write_bytes(b"truncated")
        self.assertIsNone(engine.model_directory("en"))

    def test_voice_path_and_unverified_language_rejected_before_importing_model(self):
        for voice in ["../private", "jf_alpha", "zf_xiaobei", ""]:
            with self.assertRaisesRegex(ValueError, "当前模型支持"):
                engine.build_pipeline("en", voice)

    def test_delete_only_removes_application_owned_files(self):
        shared = engine.model_cache_dir("en")
        shared.mkdir(parents=True)
        sentinel = shared / "do-not-delete"
        sentinel.write_text("shared")
        with patch("engine.emit"):
            engine.cmd_delete(type("Args", (), {"model": "en"})())
        self.assertTrue(sentinel.is_file())
        self.assertFalse(self.model.exists())
        self.assertTrue((self.models / "en.disabled").exists())

    def test_fill_missing_voices_reuses_existing_weights_offline(self):
        voice = self.model / "voices/af_heart.pt"
        voice.write_bytes(b"voice")
        self.complete()
        # 损坏一个声音时仍只修复声音，不重下有效的主权重。
        voice.write_bytes(b"broken-voice")
        required = ["config.json", engine.MODELS["en"]["weight"], *(
            f"voices/{name}.pt" for _, entries in engine.VOICE_GROUPS["en"] for name, _ in entries
            if name[0] in "ab"
        )]
        calls = []

        def download(**kwargs):
            calls.append(kwargs)
            for name in kwargs["allow_patterns"]:
                self.assertTrue(name.startswith("voices/"))
                (self.model / name).write_bytes(b"voice")
            return str(self.model)

        info = SimpleNamespace(sha=engine.MODELS["en"]["revision"], siblings=[
            SimpleNamespace(rfilename=name, size=5 if name.startswith("voices/")
                            else (self.model / name).stat().st_size) for name in required
        ])
        api = SimpleNamespace(model_info=lambda *args, **kwargs: info)
        hub = SimpleNamespace(HfApi=lambda: api, snapshot_download=download)
        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch("engine.emit"):
            engine.cmd_download(SimpleNamespace(model="en"))
            self.assertTrue(engine.model_installed("en"))
            self.assertEqual(len(calls), 1)
            # 资源齐全后再次点击不会进行模型请求或下载。
            hub.HfApi = lambda: SimpleNamespace(model_info=lambda *a, **k: self.fail("不应联网"))
            engine.cmd_download(SimpleNamespace(model="en"))
            self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
