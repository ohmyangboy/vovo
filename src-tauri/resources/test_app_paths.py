import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import app_paths


class AppPathsTests(unittest.TestCase):
    def test_new_environment_takes_priority_and_legacy_still_works(self):
        with patch.dict(os.environ, {"VOVO_HOME": "/new-vovo", "VOICE_STUDIO_HOME": "/old-voice"}, clear=True):
            self.assertEqual(app_paths.app_home(), Path("/new-vovo"))
        with patch.dict(os.environ, {"VOICE_STUDIO_HOME": "/old-voice"}, clear=True):
            self.assertEqual(app_paths.app_home(), Path("/old-voice"))

    def test_new_directory_and_old_models_are_detected_without_redownload(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch.object(app_paths.sys, "platform", "darwin"), patch.object(Path, "home", return_value=Path(directory)):
            parent = Path(directory) / "Library/Application Support"
            self.assertEqual(app_paths.app_home(), parent / "vovo")
            (parent / "VoiceStudio").mkdir(parents=True)
            self.assertEqual(app_paths.app_home(), parent / "VoiceStudio")
            (parent / "vovo").mkdir()
            self.assertEqual(app_paths.app_home(), parent / "vovo")
