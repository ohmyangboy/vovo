"""Cloning-specific phrasing, reference selection and pitch-preserving tempo."""
import math
import re
import subprocess
from pathlib import Path

from text_processing import PAUSE_RE, split_sentences


def language_for(text):
    han = bool(re.search(r"[\u3400-\u9fff]", text))
    latin = bool(re.search(r"[A-Za-z]", text))
    if han and not latin:
        return "chinese"
    if latin and not han:
        return "english"
    return "auto"


def speech_items(text):
    """Keep English clauses together; only add silence at real boundaries."""
    items = []

    def phrases(source):
        language = language_for(source)
        limit = 320 if language == "english" else 90 if language == "chinese" else 170
        return [(sentence, .06 if re.search(r"[.!?。！？][\"'”’）)]*$", sentence) else 0)
                for sentence in split_sentences(source, max_len=limit)]

    for paragraph in re.split(r"\n\s*\n", text):
        local, cursor = [], 0
        for marker in PAUSE_RE.finditer(paragraph):
            before = phrases(paragraph[cursor:marker.start()])
            local.extend(before)
            value = marker.group(1) or marker.group(2)
            pause = float(value) if value else 1.5
            if not math.isfinite(pause) or not .1 <= pause <= 10:
                raise ValueError("停顿长度须为 0.1–10 秒")
            if before:
                local[-1] = (local[-1][0], pause)
            else:
                local.append(("", pause))
            cursor = marker.end()
        tail = phrases(paragraph[cursor:])
        local.extend(tail)
        if tail:
            local[-1] = (local[-1][0], .22)
        items.extend(local)
    # No synthetic trailing silence, except an explicitly requested pause.
    explicit_end = any(marker.end() == len(text.rstrip()) for marker in PAUSE_RE.finditer(text.rstrip()))
    if items and not explicit_end:
        items[-1] = (items[-1][0], 0)
    return items


def pick_reference(text, references):
    language = language_for(text)
    return next((ref for ref in reversed(references) if language != "auto" and
                 language_for(ref["refText"]) == language), references[0])


def validate_speed(value):
    speed = float(value)
    if not math.isfinite(speed) or not .8 <= speed <= 1.3:
        raise ValueError("语速须为 0.8–1.3 倍")
    return speed


def change_tempo(samples, sample_rate, captions, speed, work, ffmpeg):
    """FFmpeg atempo changes the exported audio, without shifting its pitch."""
    speed = validate_speed(speed)
    if speed == 1:
        return samples, captions
    import numpy as np
    import soundfile as sf
    source, target = Path(work) / "tempo-source.wav", Path(work) / "tempo-result.wav"
    sf.write(source, samples, sample_rate, subtype="FLOAT")
    subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                    "-threads", "1", "-i", str(source), "-af", f"atempo={speed}",
                    "-c:a", "pcm_f32le", str(target)], check=True, timeout=120)
    adjusted, rate = sf.read(target, dtype="float32")
    if rate != sample_rate or not len(adjusted) or not np.isfinite(adjusted).all():
        raise ValueError("语速调整失败，请重试")
    ratio = len(adjusted) / len(samples)
    return adjusted, [(start * ratio, end * ratio, text) for start, end, text in captions]
