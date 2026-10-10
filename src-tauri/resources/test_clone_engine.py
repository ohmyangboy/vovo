import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys
import hashlib
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("clone_engine", Path(__file__).with_name("clone_engine.py"))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        p = Path(self.tmp.name) / "reference.m4a"
        p.touch()
        self.req = dict(reference=str(p), refText="参考片段", text="你好，世界。", start=0, duration=10, outdir=self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_local_reference_accepted(self):
        self.assertEqual(engine.validate(self.req)[0], "你好，世界。")

    def test_invalid_inputs_fail_before_model_load(self):
        for update in [dict(text=" "), dict(refText=""), dict(reference="https://example.com/a.wav"), dict(reference="/tmp/nope.txt"), dict(start=-1), dict(duration=21), dict(duration=float('nan')), dict(outdir="")]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                engine.validate(self.req | update)

    def test_subtitle_rollover(self):
        self.assertEqual(engine.timestamp(59.9999), "00:01:00,000")

    def test_bad_speed_or_extra_reference_fails_before_model_load(self):
        for update in [dict(speed=1.5), dict(speed=float('nan')), dict(references=[{}]),
                       dict(references=[dict(reference=self.req['reference'], refText='English', duration=30)]),
                       dict(references=[self.req] * 3)]:
            with self.subTest(update=update), self.assertRaises(ValueError):
                engine.validate(self.req | update)


class DownloadTests(unittest.TestCase):
    def test_progress_does_not_regress_and_completed_model_is_reused_offline(self):
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary)
            info = SimpleNamespace(sha=engine.REVISION, siblings=[
                SimpleNamespace(rfilename="config.json", size=10),
                SimpleNamespace(rfilename="model.safetensors", size=20),
            ])
            calls = []
            class Progress:
                def __init__(self, *args, **kwargs):
                    self.n = 0
                def update(self, n=1):
                    self.n += n
            def download(_repo, filename, **kwargs):
                calls.append(filename)
                progress = kwargs["tqdm_class"]()
                progress.update(8)
                progress.n = 2  # 下载/重建双进度交替产生的较小值。
                progress.update(0)
                size = next(file.size for file in info.siblings if file.rfilename == filename)
                (model / filename).write_bytes(b"x" * size)
            api = SimpleNamespace(model_info=lambda *a, **k: info)
            hub = SimpleNamespace(HfApi=lambda: api, hf_hub_download=download)
            with patch.object(engine, "MODEL", model), patch.dict(sys.modules, {
                "huggingface_hub": hub, "tqdm.auto": SimpleNamespace(tqdm=Progress),
            }), patch.object(engine.time, "monotonic", side_effect=range(1, 10)), patch.object(engine, "emit") as events:
                engine.download()
                progress = [call.kwargs["done"] for call in events.call_args_list if call.args[0] == "progress"]
                self.assertEqual(progress, sorted(progress))
                self.assertTrue(engine.status()["installed"])
                hub.HfApi = lambda: self.fail("完整克隆模型不应再次联网")
                engine.download()
                self.assertEqual(len(calls), 2)

    def test_incomplete_file_does_not_publish_ready_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary)
            info = SimpleNamespace(sha=engine.REVISION, siblings=[SimpleNamespace(rfilename="config.json", size=10)])
            def download(_repo, filename, **kwargs):
                (model / filename).write_bytes(b"bad")
            hub = SimpleNamespace(HfApi=lambda: SimpleNamespace(model_info=lambda *a, **k: info), hf_hub_download=download)
            with patch.object(engine, "MODEL", model), patch.dict(sys.modules, {"huggingface_hub": hub}), patch.object(engine, "emit"):
                with self.assertRaisesRegex(ValueError, "未下载完整"):
                    engine.download()
                self.assertFalse((model / ".complete.json").exists())
                self.assertFalse(engine.status()["installed"])

    def test_temporary_network_failure_retries_without_losing_completed_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary)
            content = b"verified model"
            info = SimpleNamespace(sha=engine.REVISION, siblings=[SimpleNamespace(
                rfilename="model.safetensors", size=len(content), lfs={"sha256":hashlib.sha256(content).hexdigest()})])
            attempts = []
            def download(_repo, filename, **kwargs):
                attempts.append(filename)
                if len(attempts) == 1:
                    raise ConnectionError("temporary transfer failure")
                (model / filename).write_bytes(content)
            hub = SimpleNamespace(HfApi=lambda: SimpleNamespace(model_info=lambda *a, **k: info), hf_hub_download=download)
            with patch.object(engine, "MODEL", model), patch.dict(sys.modules, {"huggingface_hub":hub}), patch.object(engine, "emit"), patch.object(engine.time, "sleep"):
                engine.download()
                self.assertEqual(len(attempts), 2)
                self.assertTrue(engine.status()["installed"])

    def test_same_size_corruption_fails_checksum_and_is_not_marked_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary)
            info = SimpleNamespace(sha=engine.REVISION, siblings=[SimpleNamespace(
                rfilename="model.safetensors", size=4, lfs={"sha256":hashlib.sha256(b"good").hexdigest()})])
            def download(_repo, filename, **kwargs):
                (model / filename).write_bytes(b"bad!")
            hub = SimpleNamespace(HfApi=lambda: SimpleNamespace(model_info=lambda *a, **k: info), hf_hub_download=download)
            with patch.object(engine, "MODEL", model), patch.dict(sys.modules, {"huggingface_hub":hub}), patch.object(engine, "emit"):
                with self.assertRaisesRegex(ValueError, "校验失败"):
                    engine.download()
                self.assertFalse((model / ".complete.json").exists())
                self.assertFalse((model / "model.safetensors").exists())

if __name__ == '__main__':
    unittest.main()
