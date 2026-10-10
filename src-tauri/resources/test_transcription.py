import errno
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import wave

import transcription as engine


class TranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.model = self.root / "model"
        self.audio = self.root / "prepared-reference.wav"
        self.write_wave()
        self.model_patch = patch.object(engine, "MODEL", self.model)
        self.model_patch.start()

    def tearDown(self):
        self.model_patch.stop()
        self.temporary.cleanup()

    def write_wave(self, duration=3, channels=1, sample_rate=24000):
        with wave.open(str(self.audio), "wb") as source:
            source.setnchannels(channels)
            source.setsampwidth(2)
            source.setframerate(sample_rate)
            source.writeframes(b"\x00\x10" * round(duration * sample_rate) * channels)

    def ready_model(self):
        self.model.mkdir()
        for name in engine.FILES:
            (self.model / name).write_bytes(b"test")
        manifest = dict(repo=engine.REPO, revision=engine.REVISION,
                        files={name: 4 for name in engine.FILES})
        (self.model / ".complete.json").write_text(json.dumps(manifest))

    def test_only_prepared_local_short_mono_audio_is_accepted(self):
        self.assertEqual(engine.validate_audio(str(self.audio)), self.audio)
        for audio in ["https://example.com/voice.wav", "relative.wav", str(self.root / "missing.wav")]:
            with self.subTest(audio=audio), self.assertRaises(ValueError):
                engine.validate_audio(audio)
        for settings in [dict(duration=2), dict(duration=21), dict(channels=2), dict(sample_rate=16000)]:
            self.write_wave(**settings)
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                engine.validate_audio(str(self.audio))

    def test_cached_complete_model_needs_no_network_and_missing_file_is_not_ready(self):
        self.ready_model()
        with patch.dict(sys.modules, {"huggingface_hub": None}):
            engine.download()
        self.assertTrue(engine.installed())
        (self.model / "vocab.json").unlink()
        self.assertFalse(engine.installed())

    def test_wrong_revision_and_malformed_marker_are_not_ready(self):
        self.ready_model()
        marker = self.model / ".complete.json"
        manifest = json.loads(marker.read_text())
        manifest["revision"] = "other-version"
        for data in [manifest, [], {"files": []}, "invalid"]:
            marker.write_text(json.dumps(data))
            with self.subTest(data=data):
                self.assertFalse(engine.installed())

    def test_inference_reads_exact_prepared_clip_and_uses_local_model_offline(self):
        self.ready_model()
        model = SimpleNamespace(generate=Mock(return_value=SimpleNamespace(text="  大家好，这是识别的文字。  ")))
        loader = Mock(return_value=model)
        mx = SimpleNamespace(set_cache_limit=Mock(), set_memory_limit=Mock())
        with patch.dict(sys.modules, {
            "mlx": SimpleNamespace(core=mx), "mlx.core": mx,
            "mlx_audio.stt.utils": SimpleNamespace(load_model=loader),
            "huggingface_hub": None,
        }), patch.object(engine.importlib.metadata, "version", return_value="0.5.8"), \
                patch.dict(engine.os.environ, {}, clear=True), patch.object(engine, "emit") as events:
            self.assertEqual(engine.transcribe(str(self.audio)), "大家好，这是识别的文字。")
            self.assertEqual(engine.os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(engine.os.environ["TRANSFORMERS_OFFLINE"], "1")
            loader.assert_called_once_with(self.model)
            self.assertEqual(model.generate.call_args.kwargs["audio"], str(self.audio))
            self.assertEqual(events.call_args.kwargs["text"], "大家好，这是识别的文字。")
            model.generate.return_value.text = " "
            with self.assertRaisesRegex(ValueError, "没有识别到"):
                engine.transcribe(str(self.audio))

    def test_invalid_audio_or_runtime_fails_before_model_download(self):
        with patch.object(engine, "download") as download:
            with self.assertRaises(ValueError):
                engine.transcribe("https://example.com/audio.wav")
            with patch.object(engine.importlib.metadata, "version", return_value="0.5.7"), \
                    self.assertRaisesRegex(ValueError, "一键准备"):
                engine.transcribe(str(self.audio))
            download.assert_not_called()

    def fake_download(self, fail=None):
        content = b"model file contents"
        files = [SimpleNamespace(rfilename=name, size=len(content),
                                 lfs={"sha256": hashlib.sha256(content).hexdigest()})
                 for name in sorted(engine.FILES)]
        calls = []
        def download(_repo, name, **kwargs):
            calls.append(name)
            if fail:
                fail(len(calls))
            (self.model / name).write_bytes(content)
        info = SimpleNamespace(sha=engine.REVISION, siblings=files)
        hub = SimpleNamespace(HfApi=lambda: SimpleNamespace(model_info=lambda *a, **k: info),
                              hf_hub_download=download)
        return hub, calls

    def test_download_retries_and_only_publishes_complete_verified_model(self):
        def fail(count):
            if count == 2:
                raise ConnectionError("temporary network failure")
        hub, calls = self.fake_download(fail)
        with patch.dict(sys.modules, {"huggingface_hub": hub}), \
                patch.object(engine.time, "sleep"), patch.object(engine, "emit"):
            engine.download()
        self.assertEqual(len(calls), len(engine.FILES) + 1)
        self.assertTrue(engine.installed())

    def test_disk_full_does_not_retry_or_mark_ready(self):
        def fail(_count):
            raise OSError(errno.ENOSPC, "disk full")
        hub, calls = self.fake_download(fail)
        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch.object(engine, "emit"), \
                self.assertRaises(OSError):
            engine.download()
        self.assertEqual(len(calls), 1)
        self.assertFalse(engine.installed())

    def test_same_size_corruption_does_not_mark_ready(self):
        hub, _calls = self.fake_download()
        def corrupt(_repo, name, **kwargs):
            (self.model / name).write_bytes(b"wrong file contents")
        hub.hf_hub_download = corrupt
        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch.object(engine, "emit"), \
                self.assertRaisesRegex(ValueError, "校验失败"):
            engine.download()
        self.assertFalse(engine.installed())
        self.assertFalse((self.model / ".complete.json").exists())


if __name__ == "__main__":
    unittest.main()
