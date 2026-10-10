"""共享文本切分与句级字幕工具，不依赖推理环境。"""
from __future__ import annotations

import math
import re
from pathlib import Path

PAUSE_RE = re.compile(
    r"\[(?:pause|break)(?:\.{1,3}|\s*[:：]\s*(\d+(?:\.\d+)?)\s*s?)?\]"
    r"|【停顿(?:\s*[:：]\s*(\d+(?:\.\d+)?)\s*秒?)?】",
    re.IGNORECASE,
)
ABBREVIATIONS = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|No|Fig)\.|\b(?:e\.g|i\.e)\.", re.I)
PROTECTED = re.compile(r"https?://[^\s<>]+|[\w.+-]+@[\w.-]+\.\w+|\d+(?:\.\d+)+|(?:[A-Za-z]\.){2,}")
CLOSERS = '\"\'”’」』）)]'


def clean_marks(text: str) -> str:
    return PAUSE_RE.sub(" ", text)


def _split_long(text: str, max_len: int) -> list[str]:
    out = []
    while len(text) > max_len:
        candidates = [m.end() for m in re.finditer(r"[,;，；、\s]", text[:max_len])]
        cut = next((n for n in reversed(candidates) if n >= max_len // 2), max_len)
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        out.append(text)
    return out


def split_sentences(text: str, max_len: int = 260) -> list[str]:
    if max_len < 1:
        raise ValueError("切分长度须大于零")
    text = text.strip()
    protected = set()
    for pattern in (PROTECTED, ABBREVIATIONS):
        for match in pattern.finditer(text):
            end = match.end()
            if match.group().startswith(("http://", "https://")):
                end = match.start() + len(match.group().rstrip('.!?。！？,，'))
            protected.update(range(match.start(), end))
    parts, start, i = [], 0, 0
    while i < len(text):
        char = text[i]
        boundary = char in "。！？!?\n" or (char == "." and i not in protected)
        if boundary:
            end = i + 1
            while end < len(text) and text[end] in CLOSERS + "。！？!?":
                end += 1
            piece = text[start:end].strip()
            if piece:
                parts.extend(_split_long(piece, max_len))
            start = end
            i = end
        else:
            i += 1
    if text[start:].strip():
        parts.extend(_split_long(text[start:].strip(), max_len))
    return parts


def prepare_items(paragraphs: list[str], max_len: int = 260) -> list[tuple[str, float]]:
    items = []
    for paragraph in paragraphs:
        local, cursor = [], 0
        for marker in PAUSE_RE.finditer(paragraph):
            before = split_sentences(paragraph[cursor:marker.start()], max_len)
            local.extend((sentence, .3) for sentence in before)
            value = marker.group(1) or marker.group(2)
            pause = float(value) if value else 1.5
            if not math.isfinite(pause) or not .1 <= pause <= 10:
                raise ValueError("停顿长度须为 0.1–10 秒")
            if before:
                local[-1] = (local[-1][0], pause)
            else:
                local.append(("", pause))
            cursor = marker.end()
        tail = split_sentences(paragraph[cursor:], max_len)
        local.extend((sentence, .3) for sentence in tail)
        if tail:
            local[-1] = (local[-1][0], .6)
        items.extend(local)
    return items


def fmt_ts(seconds: float) -> str:
    if not math.isfinite(seconds) or seconds < 0:
        raise ValueError("字幕时间无效")
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def caption_text(text: str) -> str:
    lines = [" ".join(line.split()) for line in text.splitlines() if line.strip()]
    if len(lines) > 1:
        return "\n".join(lines)
    text = " ".join(text.split())
    limit = 22 if re.search(r"[\u3400-\u9fff]", text) else 44
    if len(text) <= limit:
        return text
    middle = len(text) // 2
    spaces = [m.start() for m in re.finditer(r"\s", text)]
    cut = min(spaces, key=lambda n: abs(n - middle)) if spaces else middle
    return text[:cut].strip() + "\n" + text[cut:].strip()


def write_srt(path: Path, entries: list[tuple[float, float, str]]) -> None:
    lines, previous_end = [], 0.0
    for i, (start, end, text) in enumerate(entries, 1):
        if not (math.isfinite(start) and math.isfinite(end) and start >= 0 and start >= previous_end - .001 and end > start and text.strip()):
            raise ValueError("字幕时间轴无效")
        lines.extend((str(i), f"{fmt_ts(start)} --> {fmt_ts(end)}", caption_text(text), ""))
        previous_end = end
    path.write_text("\n".join(lines), encoding="utf-8")
