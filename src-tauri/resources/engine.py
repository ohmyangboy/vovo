#!/usr/bin/env python3
"""配音工坊本地引擎。

所有与 TTS 模型的交互都通过这个脚本完成，App 仅负责界面。

子命令：
  check                                       环境与模型状态（JSON）
  list-voices                                 模型与音色清单（JSON）
  download --model en|zh                      下载模型
  delete   --model en|zh                      删除模型缓存
  preview  --model en|zh --voice V --out F    生成音色试听
  import-doc --path FILE                      解析文稿 -> 段落 JSON
  generate --model en|zh --voice V --input P --outdir D --name BASE [--speed 1.0]

约定：stdout 只输出 JSON Lines（机器可读），stderr 输出人类日志。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

SR = 24000
HF_HOME = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface"))
HF_HUB = HF_HOME / "hub"

# 让子进程（如 spacy 的自动安装逻辑）能发现当前虚拟环境
_venv_root = Path(sys.prefix)
if "VIRTUAL_ENV" not in os.environ and (_venv_root / "pyvenv.cfg").exists():
    os.environ["VIRTUAL_ENV"] = str(_venv_root)

MODELS: dict[str, dict] = {
    "en": {
        "repo": "hexgrad/Kokoro-82M",
        "name": "Kokoro 英文 v1.0",
        "lang": "a",
        "desc": "美式 / 英式英语，54 个音色",
    },
    "zh": {
        "repo": "hexgrad/Kokoro-82M-v1.1-zh",
        "name": "Kokoro 中英双语 v1.1-zh",
        "lang": "z",
        "desc": "100 个中文音色 + 3 个英文音色，支持中英混读",
    },
}

# ---------------------------------------------------------------- 音色数据

EN_VOICE_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("美式英语 · 女声", [
        ("af_heart", "温暖自然（推荐）"),
        ("af_bella", "明亮有表现力"),
        ("af_nicole", "柔和气声"),
        ("af_sarah", "清晰播报"),
        ("af_sky", "轻快"),
        ("af_aoede", "沉稳"),
        ("af_kore", ""),
        ("af_nova", ""),
        ("af_jessica", ""),
        ("af_river", ""),
        ("af_alloy", ""),
    ]),
    ("美式英语 · 男声", [
        ("am_michael", "沉稳（推荐）"),
        ("am_fenrir", "浑厚有力"),
        ("am_onyx", "低沉"),
        ("am_puck", "活泼"),
        ("am_adam", ""),
        ("am_echo", ""),
        ("am_eric", ""),
        ("am_liam", ""),
        ("am_santa", ""),
    ]),
    ("英式英语 · 女声", [
        ("bf_emma", "清晰（推荐）"),
        ("bf_alice", ""),
        ("bf_isabella", ""),
        ("bf_lily", ""),
    ]),
    ("英式英语 · 男声", [
        ("bm_george", "沉稳（推荐）"),
        ("bm_daniel", ""),
        ("bm_fable", ""),
        ("bm_lewis", ""),
    ]),
    ("其他语言", [
        ("ef_dora", "西班牙语 · 女声"),
        ("em_alex", "西班牙语 · 男声"),
        ("em_santa", "西班牙语 · 男声"),
        ("ff_siwis", "法语 · 女声"),
        ("hf_alpha", "印地语 · 女声"),
        ("hf_beta", "印地语 · 女声"),
        ("hm_omega", "印地语 · 男声"),
        ("hm_psi", "印地语 · 男声"),
        ("if_sara", "意大利语 · 女声"),
        ("im_nicola", "意大利语 · 男声"),
        ("jf_alpha", "日语 · 女声"),
        ("jf_gongitsune", "日语 · 女声"),
        ("jf_nezumi", "日语 · 女声"),
        ("jf_tebukuro", "日语 · 女声"),
        ("jm_kumo", "日语 · 男声"),
        ("pf_dora", "葡萄牙语 · 女声"),
        ("pm_alex", "葡萄牙语 · 男声"),
        ("pm_santa", "葡萄牙语 · 男声"),
        ("zf_xiaobei", "中文 · 女声"),
        ("zf_xiaoni", "中文 · 女声"),
        ("zf_xiaoxiao", "中文 · 女声"),
        ("zf_xiaoyi", "中文 · 女声"),
        ("zm_yunjian", "中文 · 男声"),
        ("zm_yunxi", "中文 · 男声"),
        ("zm_yunxia", "中文 · 男声"),
        ("zm_yunyang", "中文 · 男声"),
    ]),
]

ZF_VOICES = [
    "zf_001", "zf_002", "zf_003", "zf_004", "zf_005", "zf_006", "zf_007",
    "zf_008", "zf_017", "zf_018", "zf_019", "zf_021", "zf_022", "zf_023",
    "zf_024", "zf_026", "zf_027", "zf_028", "zf_032", "zf_036", "zf_038",
    "zf_039", "zf_040", "zf_042", "zf_043", "zf_044", "zf_046", "zf_047",
    "zf_048", "zf_049", "zf_051", "zf_059", "zf_060", "zf_067", "zf_070",
    "zf_071", "zf_072", "zf_073", "zf_074", "zf_075", "zf_076", "zf_077",
    "zf_078", "zf_079", "zf_083", "zf_084", "zf_085", "zf_086", "zf_087",
    "zf_088", "zf_090", "zf_092", "zf_093", "zf_094", "zf_099",
]
ZM_VOICES = [
    "zm_009", "zm_010", "zm_011", "zm_012", "zm_013", "zm_014", "zm_015",
    "zm_016", "zm_020", "zm_025", "zm_029", "zm_030", "zm_031", "zm_033",
    "zm_034", "zm_035", "zm_037", "zm_041", "zm_045", "zm_050", "zm_052",
    "zm_053", "zm_054", "zm_055", "zm_056", "zm_057", "zm_058", "zm_061",
    "zm_062", "zm_063", "zm_064", "zm_065", "zm_066", "zm_068", "zm_069",
    "zm_080", "zm_081", "zm_082", "zm_089", "zm_091", "zm_095", "zm_096",
    "zm_097", "zm_098", "zm_100",
]

ZH_VOICE_GROUPS: list[tuple[str, list[tuple[str, str]]]] = [
    ("中文 · 女声", [(v, "") for v in ZF_VOICES]),
    ("中文 · 男声", [(v, "") for v in ZM_VOICES]),
    ("该模型内置英文音色", [
        ("af_maple", "美式英语 · 女声"),
        ("af_sol", "美式英语 · 女声"),
        ("bf_vale", "英式英语 · 女声"),
    ]),
]

VOICE_GROUPS = {"en": EN_VOICE_GROUPS, "zh": ZH_VOICE_GROUPS}

PREVIEW_TEXT = {
    "en": "Hello. This is a short preview of how this voice sounds when reading a script.",
    "zh": "你好，这是一段音色试听。这段话可以帮你感受这个声音的实际效果。",
}


# ---------------------------------------------------------------- 基础工具

def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


def model_cache_dir(model_id: str) -> Path:
    repo = MODELS[model_id]["repo"]
    return HF_HUB / ("models--" + repo.replace("/", "--"))


def model_files(model_id: str) -> list[Path]:
    root = model_cache_dir(model_id)
    if not root.exists():
        return []
    return list((root / "snapshots").glob("*/*.pth"))


def model_installed(model_id: str) -> bool:
    return len(model_files(model_id)) > 0


def model_size_mb(model_id: str) -> float:
    root = model_cache_dir(model_id)
    if not root.exists():
        return 0.0
    total = sum(f.stat().st_size for f in root.rglob("*") if f.is_file())
    return round(total / 1024 / 1024, 1)


# ---------------------------------------------------------------- 文本处理

MARK_RE = re.compile(r"\[[^\]]*\]|【[^】]*】")

ABBREV = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "St.", "vs.", "etc.", "No.", "Fig.", "e.g.", "i.e."]


def clean_marks(text: str) -> str:
    """去掉舞台指示标记，如 [Pause...]、【停顿】。"""
    return MARK_RE.sub(" ", text)


def split_sentences(text: str, max_len: int = 260) -> list[str]:
    text = text.strip()
    if not text:
        return []
    # 保护常见缩写，避免被误切
    for ab in ABBREV:
        text = text.replace(ab, ab.replace(".", "\u2024"))
    parts = re.split(r"(?<=[.!?。！？])\s*", text)
    parts = [p.replace("\u2024", ".").strip() for p in parts]
    parts = [p for p in parts if p]
    out: list[str] = []
    for s in parts:
        if len(s) <= max_len:
            out.append(s)
            continue
        buf = ""
        for sub in re.split(r"(?<=[,;，；])\s*", s):
            if buf and len(buf) + len(sub) > max_len:
                out.append(buf.strip())
                buf = sub
            else:
                buf += sub
        if buf.strip():
            out.append(buf.strip())
    return out or [text]


def prepare_items(paragraphs: list[str]) -> list[tuple[str, float]]:
    """把段落转成 (句子, 句后停顿秒数) 序列。"""
    items: list[tuple[str, float]] = []
    for para in paragraphs:
        has_mark = bool(MARK_RE.search(para))
        trailing_mark = has_mark and bool(MARK_RE.search(para.rstrip()[-40:])) and para.rstrip().endswith(("]", "】", "。", ".", "?", "？", "!", "！"))
        clean = clean_marks(para)
        sents = split_sentences(clean)
        for i, s in enumerate(sents):
            last = i == len(sents) - 1
            if last:
                pause = 1.5 if (trailing_mark or has_mark) else 0.6
            else:
                pause = 0.3
            items.append((s, pause))
    return items


def fmt_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(path: Path, entries: list[tuple[float, float, str]]) -> None:
    lines = []
    for i, (t0, t1, text) in enumerate(entries, 1):
        lines.append(str(i))
        lines.append(f"{fmt_ts(t0)} --> {fmt_ts(t1)}")
        lines.append(text)
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_mp3(path: Path, samples) -> None:
    import lameenc
    import numpy as np

    pcm = np.clip(samples, -1.0, 1.0)
    pcm = (pcm * 32767).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(96)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    path.write_bytes(enc.encode(pcm) + enc.flush())


# ---------------------------------------------------------------- TTS 管线

def build_pipeline(model_id: str):
    """返回 (pipeline, synth_fn)。第一次调用会下载模型文件。"""
    from kokoro import KModel, KPipeline

    repo = MODELS[model_id]["repo"]
    if model_id == "zh":
        en_pipe = KPipeline(lang_code="a", repo_id=repo, model=False)

        def en_callable(text: str) -> str:
            try:
                return next(en_pipe(text)).phonemes
            except Exception:
                return text

        kmodel = KModel(repo_id=repo).eval()
        pipe = KPipeline(lang_code="z", repo_id=repo, model=kmodel, en_callable=en_callable)
    else:
        pipe = KPipeline(lang_code="a", repo_id=repo)
    return pipe


def synth_sentence(pipe, text: str, voice: str, speed: float):
    import numpy as np

    chunks = []
    for _, _, audio in pipe(text, voice=voice, speed=speed):
        if audio is None:
            continue
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        chunks.append(audio)
    if not chunks:
        raise RuntimeError(f"未能合成：{text[:40]}")
    return np.concatenate(chunks)


# ---------------------------------------------------------------- 子命令

def cmd_check(_args) -> None:
    import importlib

    info: dict = {"type": "check", "python": sys.version.split()[0], "packages": {}, "models": {}}
    merged = {**MODELS}
    for mid in merged:
        mid_info = {
            "installed": model_installed(mid),
            "sizeMB": model_size_mb(mid),
            "name": MODELS[mid]["name"],
        }
        info["models"][mid] = mid_info

    kokoro_ok = True
    for mod, label in [("kokoro", "kokoro"), ("soundfile", "soundfile"), ("numpy", "numpy"),
                       ("lameenc", "lameenc"), ("docx", "python-docx"), ("huggingface_hub", "huggingface_hub")]:
        try:
            m = importlib.import_module(mod)
            info["packages"][label] = getattr(m, "__version__", "ok")
        except Exception:
            info["packages"][label] = None
            kokoro_ok = False
    info["ready"] = kokoro_ok
    emit(info)


def cmd_list_voices(_args) -> None:
    models = []
    for mid, meta in MODELS.items():
        voices = []
        for group, entries in VOICE_GROUPS[mid]:
            for vid, label in entries:
                voices.append({"id": vid, "group": group, "label": label})
        models.append({
            "id": mid,
            "name": meta["name"],
            "desc": meta["desc"],
            "installed": model_installed(mid),
            "sizeMB": model_size_mb(mid),
            "voices": voices,
        })
    emit({"type": "voices", "models": models})


def cmd_download(args) -> None:
    model_id = args.model
    repo = MODELS[model_id]["repo"]
    emit({"type": "log", "message": f"开始下载 {MODELS[model_id]['name']}..."})
    try:
        from huggingface_hub import snapshot_download

        def run(endpoint: str | None = None) -> str:
            if endpoint:
                os.environ["HF_ENDPOINT"] = endpoint
                emit({"type": "log", "message": f"使用镜像 {endpoint}"})
            return snapshot_download(repo_id=repo, allow_patterns=["config.json", "*.pth"])

        try:
            path = run()
        except Exception as first:
            emit({"type": "log", "message": f"直连失败：{first}，尝试国内镜像..."})
            path = run("https://hf-mirror.com")
        emit({"type": "done", "path": str(path), "sizeMB": model_size_mb(model_id)})
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"下载失败：{exc}"})
        sys.exit(1)


def cmd_delete(args) -> None:
    model_id = args.model
    root = model_cache_dir(model_id)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    emit({"type": "done", "freed": str(root)})


def cmd_preview(args) -> None:
    pipe = build_pipeline(args.model)
    text = PREVIEW_TEXT[args.model]
    wav = synth_sentence(pipe, text, args.voice, 1.0)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_mp3(out, wav)
    emit({"type": "done", "out": str(out)})


def cmd_import_doc(args) -> None:
    path = Path(args.path)
    suffix = path.suffix.lower()
    title = path.stem
    if suffix == ".docx":
        import docx

        doc = docx.Document(str(path))
        paras = [p.text.strip() for p in doc.paragraphs]
    else:
        raw = path.read_text(encoding="utf-8", errors="ignore")
        if suffix in (".md", ".markdown"):
            raw = re.sub(r"^#{1,6}\s*", "", raw, flags=re.M)
            raw = re.sub(r"\*\*([^*]+)\*\*", r"\1", raw)
            raw = re.sub(r"\*([^*]+)\*", r"\1", raw)
            raw = re.sub(r"`([^`]+)`", r"\1", raw)
            raw = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", raw)
            raw = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", raw)
            raw = re.sub(r"^\s*[-*+]\s+", "", raw, flags=re.M)
            raw = re.sub(r"^\s*\d+\.\s+", "", raw, flags=re.M)
        paras = re.split(r"\n\s*\n", raw)
        paras = [x.strip() for x in paras if x.strip()]
        if len(paras) <= 1:
            paras = [x.strip() for x in raw.splitlines() if x.strip()]
    paras = [p for p in paras if p]
    emit({"type": "doc", "title": title, "paragraphs": paras, "count": len(paras)})


def cmd_generate(args) -> None:
    import numpy as np

    paragraphs = json.loads(Path(args.input).read_text(encoding="utf-8"))
    if isinstance(paragraphs, dict):
        paragraphs = paragraphs.get("paragraphs", [])
    paragraphs = [str(p) for p in paragraphs if str(p).strip()]
    if not paragraphs:
        emit({"type": "error", "message": "没有可合成的文本"})
        return

    items = prepare_items(paragraphs)
    total = len(items)
    emit({"type": "log", "message": f"加载模型 {MODELS[args.model]['name']} ..."})
    emit({"type": "progress", "stage": "synth", "done": 0, "total": total,
          "label": f"正在加载模型（共 {total} 句，首次约 1-2 分钟）"})
    pipe = build_pipeline(args.model)
    emit({"type": "progress", "stage": "synth", "done": 0, "total": total, "label": "模型就绪，开始合成"})

    silence = lambda sec: np.zeros(int(SR * sec), dtype=np.float32)
    pieces = []
    srt_entries = []
    t = 0.0
    for i, (sentence, pause) in enumerate(items, 1):
        wav = synth_sentence(pipe, sentence, args.voice, args.speed)
        dur = len(wav) / SR
        srt_entries.append((t, t + dur, sentence))
        t += dur + pause
        pieces.append(wav)
        pieces.append(silence(pause))
        emit({"type": "progress", "stage": "synth", "done": i, "total": total,
              "label": sentence[:60]})

    emit({"type": "progress", "stage": "encode", "done": 0, "total": 1, "label": "编码 MP3 与字幕"})
    full = np.concatenate(pieces)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    mp3_path = outdir / f"{args.name}.mp3"
    srt_path = outdir / f"{args.name}.srt"
    write_mp3(mp3_path, full)
    write_srt(srt_path, srt_entries)
    emit({"type": "done", "mp3": str(mp3_path), "srt": str(srt_path),
          "duration": round(len(full) / SR, 1), "sentences": total})


# ---------------------------------------------------------------- 入口

def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(prog="engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check")
    sub.add_parser("list-voices")

    p = sub.add_parser("download")
    p.add_argument("--model", required=True, choices=list(MODELS))
    p = sub.add_parser("delete")
    p.add_argument("--model", required=True, choices=list(MODELS))

    p = sub.add_parser("preview")
    p.add_argument("--model", required=True, choices=list(MODELS))
    p.add_argument("--voice", required=True)
    p.add_argument("--out", required=True)

    p = sub.add_parser("import-doc")
    p.add_argument("--path", required=True)

    p = sub.add_parser("generate")
    p.add_argument("--model", required=True, choices=list(MODELS))
    p.add_argument("--voice", required=True)
    p.add_argument("--input", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--speed", type=float, default=1.0)

    args = ap.parse_args()
    handlers = {
        "check": cmd_check,
        "list-voices": cmd_list_voices,
        "download": cmd_download,
        "delete": cmd_delete,
        "preview": cmd_preview,
        "import-doc": cmd_import_doc,
        "generate": cmd_generate,
    }
    try:
        handlers[args.cmd](args)
    except KeyboardInterrupt:
        emit({"type": "error", "message": "已取消"})
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc(file=sys.stderr)
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
