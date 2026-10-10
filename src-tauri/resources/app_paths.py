"""vovo data paths; legacy names are read only for upgrade compatibility."""
import os
from pathlib import Path
import sys


def app_home():
    explicit = os.environ.get("VOVO_HOME") or os.environ.get("VOICE_STUDIO_HOME")
    if explicit:
        return Path(explicit)
    if sys.platform == "darwin":
        parent = Path.home() / "Library/Application Support"
    elif sys.platform == "win32":
        parent = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    else:
        parent = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    current, legacy = parent / "vovo", parent / "VoiceStudio"
    return current if current.exists() or not legacy.exists() else legacy
