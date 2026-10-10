import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import engine


class PreparedSamplesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        groups = {"zh": [("中文", [("zf_001", ""), ("af_maple", "")])],
                  "en": [("英文", [("af_heart", ""), ("am_michael", ""), ("bf_emma", "")])]}
        replacements = patch.multiple(engine, MODEL_ROOT=self.root / "models", SAMPLE_ROOT=self.root / "samples",
                                      HF_HUB=self.root / "shared", VOICE_GROUPS=groups)
        replacements.start()
        self.addCleanup(replacements.stop)
        for mid in groups:
            model = engine.MODEL_ROOT / mid
            (model / "voices").mkdir(parents=True)
            (model / "config.json").write_text("{}")
            (model / engine.MODELS[mid]["weight"]).write_bytes(b"weights")
            for voice in engine.supported_voices(mid):
                (model / "voices" / f"{voice}.pt").write_bytes(b"voice")
            files = {str(file.relative_to(model)): file.stat().st_size for file in model.rglob("*") if file.is_file()}
            (model / ".complete.json").write_text(json.dumps(dict(revision=engine.MODELS[mid]["revision"], files=files)))
        self.loads = []

    def pipeline(self, mid, voice, model=None):
        self.loads.append((mid, voice, model))
        return SimpleNamespace(model=model if model is not None else object())

    def prepare(self, synth=None):
        with patch("engine.build_pipeline", side_effect=self.pipeline), \
                patch("engine.synth_sentence", side_effect=synth, return_value=np.zeros(2400, dtype=np.float32)), \
                patch("engine.emit") as events:
            engine.cmd_prepare_samples(None)
        return events

    def test_all_samples_are_playable_and_each_model_is_loaded_once(self):
        events = self.prepare()
        self.assertEqual(sum(model is None for _, _, model in self.loads), 2)
        self.assertEqual(sum(call.args[0]["type"] == "sample-ready" for call in events.call_args_list), 5)
        for mid in engine.MODELS:
            for voice in engine.supported_voices(mid):
                sample = engine.prepared_sample(mid, voice)
                self.assertTrue(Path(sample["previewAudio"]).is_file())
                self.assertGreater(sample["previewDuration"], 0)
        self.loads.clear()
        self.prepare()
        self.assertEqual(self.loads, [], "重复准备不能载入模型或再次合成")

    def test_cancelled_batch_keeps_completed_samples_and_resumes_missing_only(self):
        def cancel_on_second(_pipe, _text, voice, _speed):
            if voice.endswith("af_maple.pt"):
                raise KeyboardInterrupt()
            return np.zeros(2400, dtype=np.float32)
        with self.assertRaises(KeyboardInterrupt):
            self.prepare(cancel_on_second)
        ready = engine.prepared_sample("zh", "zf_001")
        self.assertIsNotNone(ready)
        checksum = Path(ready["previewAudio"]).read_bytes()
        self.assertIsNone(engine.prepared_sample("zh", "af_maple"))
        self.prepare()
        self.assertEqual(Path(ready["previewAudio"]).read_bytes(), checksum)
        self.assertIsNotNone(engine.prepared_sample("zh", "af_maple"))
        self.assertEqual(list(engine.SAMPLE_ROOT.rglob("*.tmp")), [])

    def test_corrupted_or_stale_sample_is_not_advertised_as_playable(self):
        self.prepare()
        audio = engine.SAMPLE_ROOT / "en/af_heart.mp3"
        content = bytearray(audio.read_bytes())
        content[-1] ^= 1  # 大小相同的损坏也必须检测。
        audio.write_bytes(content)
        self.assertIsNone(engine.prepared_sample("en", "af_heart"))
        self.loads.clear()
        self.prepare()
        self.assertEqual([(mid, voice) for mid, voice, _ in self.loads], [("en", "af_heart")])
        with patch("engine.SAMPLE_VERSION", 2):
            self.assertIsNone(engine.prepared_sample("en", "af_heart"))


if __name__ == "__main__":
    unittest.main()
