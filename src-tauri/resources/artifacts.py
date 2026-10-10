"""从原始 PCM 生成同一组音频、文稿与句级字幕。"""
from __future__ import annotations

import json
import math
import re
import subprocess
import uuid
from pathlib import Path

from text_processing import write_srt


def safe_name(name: str) -> str:
    name = re.sub(r'[/\\:*?"<>|\x00-\x1f]', "_", name).strip(" .")
    name = name.encode("utf-8")[:180].decode("utf-8", errors="ignore").strip(" .") or "配音"
    reserved = {"CON", "PRN", "AUX", "NUL", *(f"COM{n}" for n in range(1, 10)), *(f"LPT{n}" for n in range(1, 10))}
    return "_" + name if name.split(".")[0].strip().upper() in reserved else name


def write_mp3(path: Path, samples, sample_rate: int = 24000) -> None:
    import lameenc
    import numpy as np
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(160)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    path.write_bytes(encoder.encode(pcm) + encoder.flush())


def write_artifacts(outdir: Path, name: str, samples, sample_rate: int,
                    captions: list[tuple[float, float, str]], text: str,
                    ffmpeg: str | None = None) -> dict:
    import numpy as np
    import soundfile as sf
    if samples.ndim != 1 or len(samples) == 0 or not np.isfinite(samples).all():
        raise ValueError("生成的音频为空或包含异常样本")
    if not isinstance(sample_rate, int) or not 8000 <= sample_rate <= 96000:
        raise ValueError("采样率无效")
    duration = len(samples) / sample_rate
    previous = 0.0
    if not captions:
        raise ValueError("字幕为空")
    for start, end, caption in captions:
        if (not math.isfinite(start) or not math.isfinite(end) or start < 0 or start < previous - .001
                or end <= start or end > duration + .001 or not caption.strip()):
            raise ValueError("字幕与音频时间轴不一致")
        previous = end
    outdir.mkdir(parents=True, exist_ok=True)
    name = safe_name(name)
    extensions = ("wav", "mp3", "srt", "txt", "captions.json")
    base = name
    while any((outdir / f"{name}.{ext}").exists() for ext in extensions):
        name = base + "-" + uuid.uuid4().hex[:10]
    paths = {ext: outdir / f"{name}.{ext}" for ext in extensions}
    try:
        sf.write(paths["wav"], samples, sample_rate, subtype="PCM_16")
        if ffmpeg:
            subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-threads", "1", "-i", str(paths["wav"]),
                            "-c:a", "libmp3lame", "-b:a", "160k", str(paths["mp3"])], check=True, timeout=120)
        else:
            write_mp3(paths["mp3"], samples, sample_rate)
        write_srt(paths["srt"], captions)
        paths["txt"].write_text(text, encoding="utf-8")
        paths["captions.json"].write_text(json.dumps([
            dict(start=start, end=end, text=text) for start, end, text in captions
        ], ensure_ascii=False), encoding="utf-8")
    except Exception:
        for path in paths.values():
            path.unlink(missing_ok=True)
        raise
    return dict(mp3=str(paths["mp3"]), wav=str(paths["wav"]), srt=str(paths["srt"]),
                txt=str(paths["txt"]), captions=str(paths["captions.json"]),
                duration=duration, sampleRate=sample_rate, sentences=len(captions))
