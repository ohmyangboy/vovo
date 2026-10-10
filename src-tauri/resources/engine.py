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
import hashlib
import json
import math
import os
import re
import shutil
import sys
from pathlib import Path

from artifacts import write_artifacts, write_mp3
from text_processing import clean_marks, fmt_ts, prepare_items, split_sentences, write_srt

SR = 24000
HF_HOME = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface"))
HF_HUB = HF_HOME / "hub"
DEFAULT_HOME = (Path.home() / "Library/Application Support/VoiceStudio" if sys.platform == "darwin" else
                Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming")) / "VoiceStudio" if sys.platform == "win32" else
                Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "VoiceStudio")
APP_HOME = Path(os.environ.get("VOICE_STUDIO_HOME", DEFAULT_HOME))
MODEL_ROOT = APP_HOME / "models" / "kokoro"
SAMPLE_ROOT = APP_HOME / "samples"
SAMPLE_VERSION = 1

# 让子进程（如 spacy 的自动安装逻辑）能发现当前虚拟环境
_venv_root = Path(sys.prefix)
if "VIRTUAL_ENV" not in os.environ and (_venv_root / "pyvenv.cfg").exists():
    os.environ["VIRTUAL_ENV"] = str(_venv_root)

MODELS: dict[str, dict] = {
    "en": {
        "repo": "hexgrad/Kokoro-82M",
        "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987",
        "weight": "kokoro-v1_0.pth",
        "name": "Kokoro 英文 v1.0",
        "lang": "a",
        "desc": "美式 / 英式英语，54 个音色",
    },
    "zh": {
        "repo": "hexgrad/Kokoro-82M-v1.1-zh",
        "revision": "01e7505bd6a7a2ac4975463114c3a7650a9f7218",
        "weight": "kokoro-v1_1-zh.pth",
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
    "en": "Hello. A familiar voice can bring every story to life.",
    "zh": "你好，让每一段文字，都拥有自己的声音。",
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


def model_directory(model_id: str) -> Path | None:
    root = MODEL_ROOT / model_id
    if (MODEL_ROOT / f"{model_id}.disabled").exists():
        return None
    candidates = [root, model_cache_dir(model_id) / "snapshots" / MODELS[model_id]["revision"]]
    for candidate in candidates:
        if (candidate / "config.json").is_file() and (candidate / MODELS[model_id]["weight"]).is_file():
            try:
                marker = candidate / ".complete.json"
                if candidate == root and not marker.is_file():
                    continue
                if marker.exists():
                    manifest = json.loads(marker.read_text())
                    if not isinstance(manifest, dict):
                        continue
                    files = manifest.get("files", {})
                    if not isinstance(files, dict):
                        continue
                    if manifest.get("revision") != MODELS[model_id]["revision"] or not files or any(
                        not (candidate / name).is_file() or (candidate / name).stat().st_size != size
                        for name, size in files.items()
                    ):
                        continue
                return candidate
            except (OSError, ValueError, TypeError):
                continue
    return None


def model_files(model_id: str) -> list[Path]:
    root = model_directory(model_id)
    return list(root.glob("*.pth")) if root else []


def model_installed(model_id: str) -> bool:
    root = model_directory(model_id)
    return root is not None and all((root / "voices" / f"{voice}.pt").is_file()
                                   for _, entries in VOICE_GROUPS[model_id] for voice, _ in entries
                                   if voice[0] in ("ab" if model_id == "en" else "abz"))


def voice_ready(model_id: str, voice: str) -> bool:
    root = model_directory(model_id)
    return root is not None and (root / "voices" / f"{voice}.pt").is_file()


def model_size_mb(model_id: str) -> float:
    root = model_directory(model_id)
    if root is None:
        return 0.0
    return round(sum(f.stat().st_size for f in root.rglob("*") if f.is_file()) / 1024 / 1024, 1)


# ---------------------------------------------------------------- TTS 管线

def supported_voices(model_id: str) -> list[str]:
    return [vid for _, entries in VOICE_GROUPS[model_id] for vid, _ in entries
            if vid[0] in ("ab" if model_id == "en" else "abz")]


def sample_text(voice: str) -> str:
    return PREVIEW_TEXT["zh" if voice.startswith("z") else "en"]


def prepared_sample(model_id: str, voice: str) -> dict | None:
    if voice not in supported_voices(model_id):
        return None
    directory = SAMPLE_ROOT / model_id
    audio = directory / f"{voice}.mp3"
    try:
        data = json.loads((directory / f"{voice}.json").read_text())
        if (data["version"] != SAMPLE_VERSION or data["revision"] != MODELS[model_id]["revision"]
                or data["model"] != model_id or data["voice"] != voice
                or data["text"] != sample_text(voice) or not audio.is_file()
                or audio.stat().st_size != data["size"] or data["size"] <= 0
                or not math.isfinite(data["duration"]) or data["duration"] <= 0
                or hashlib.sha256(audio.read_bytes()).hexdigest() != data["sha256"]):
            return None
        return {"previewAudio": str(audio), "previewDuration": data["duration"]}
    except (OSError, ValueError, TypeError, KeyError):
        return None


def build_pipeline(model_id: str, voice: str = "", model=None):
    import importlib.util
    supported = supported_voices(model_id)
    if voice not in supported:
        raise ValueError("请选择当前模型支持的中文或英文声音")
    root = model_directory(model_id)
    if root is None or not voice_ready(model_id, voice):
        raise ValueError("模型或所选声音未准备完整，请在设置中下载/修复资源")
    if importlib.util.find_spec("en_core_web_sm") is None:
        raise ValueError("缺少英文发音资源，请在设置中修复配音环境")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from kokoro import KModel, KPipeline
    repo = MODELS[model_id]["repo"]
    language = voice[0]
    if language not in "abz":
        raise ValueError("该语言尚未通过应用内验证，请选择中文或英文声音")
    kmodel = model if model is not None else KModel(repo_id=repo, config=str(root / "config.json"), model=str(root / MODELS[model_id]["weight"])).eval()
    en_callable = None
    if language == "z":
        en_pipe = KPipeline(lang_code="a", repo_id=repo, model=False)
        def en_callable(text: str) -> str:
            return next(en_pipe(text)).phonemes
    return KPipeline(lang_code=language, repo_id=repo, model=kmodel, en_callable=en_callable)


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
                       ("lameenc", "lameenc"), ("docx", "python-docx"), ("huggingface_hub", "huggingface_hub"),
                       ("en_core_web_sm", "en_core_web_sm"), ("misaki.zh", "misaki.zh")]:
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
                if vid[0] not in ("ab" if mid == "en" else "abz"):
                    continue
                voices.append({"id": vid, "group": group, "label": label, "ready": voice_ready(mid, vid),
                               **(prepared_sample(mid, vid) or {})})
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
        from huggingface_hub import HfApi, snapshot_download
        root = MODEL_ROOT / model_id
        root.mkdir(parents=True, exist_ok=True)
        required = ["config.json", MODELS[model_id]["weight"], *(
            f"voices/{voice}.pt" for _, entries in VOICE_GROUPS[model_id] for voice, _ in entries
            if voice[0] in ("ab" if model_id == "en" else "abz")
        )]
        existing = {}
        try:
            manifest = json.loads((root / ".complete.json").read_text())
            if isinstance(manifest, dict) and manifest.get("revision") == MODELS[model_id]["revision"]:
                files = manifest.get("files", {})
                if isinstance(files, dict):
                    existing = {name: size for name, size in files.items() if name in required
                                and isinstance(size, int) and size > 0 and (root / name).is_file()
                                and (root / name).stat().st_size == size}
        except (OSError, ValueError, TypeError):
            pass
        missing = [name for name in required if name not in existing]
        if missing:
            emit({"type": "log", "message": f"复用 {len(required) - len(missing)} 个已有文件，仅补齐 {len(missing)} 个缺失资源"})
            info = HfApi().model_info(repo, revision=MODELS[model_id]["revision"], files_metadata=True)
            if info.sha != MODELS[model_id]["revision"]:
                raise ValueError("模型版本与应用要求不一致")
            expected = {file.rfilename: file.size for file in info.siblings}
            snapshot_download(repo_id=repo, revision=info.sha, local_dir=root, allow_patterns=missing)
            for name in missing:
                file = root / name
                if not file.is_file() or not expected.get(name) or file.stat().st_size != expected[name]:
                    raise ValueError(f"资源未下载完整：{name}")
        resources = [root / name for name in required]
        files = {str(p.relative_to(root)): p.stat().st_size for p in resources}
        temporary = root / ".complete.tmp"
        temporary.write_text(json.dumps(dict(revision=MODELS[model_id]["revision"], files=files)))
        os.replace(temporary, root / ".complete.json")
        (MODEL_ROOT / f"{model_id}.disabled").unlink(missing_ok=True)
        emit({"type": "done", "path": str(root), "sizeMB": model_size_mb(model_id)})
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"下载失败：{exc}"})
        sys.exit(1)


def cmd_delete(args) -> None:
    model_id = args.model
    root = MODEL_ROOT / model_id
    if root.exists():
        shutil.rmtree(root)
    if (SAMPLE_ROOT / model_id).exists():
        shutil.rmtree(SAMPLE_ROOT / model_id)
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    (MODEL_ROOT / f"{model_id}.disabled").touch()
    emit({"type": "done", "freed": str(root), "message": "应用资源已移除，共享缓存未删除"})


def cmd_preview(args) -> None:
    pipe = build_pipeline(args.model, args.voice)
    text = PREVIEW_TEXT["zh" if args.voice.startswith("z") else "en"]
    voice = str(model_directory(args.model) / "voices" / f"{args.voice}.pt")
    wav = synth_sentence(pipe, text, voice, 1.0)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_mp3(out, wav)
    emit({"type": "done", "out": str(out)})


def cmd_prepare_samples(_args) -> None:
    """一次载入每个模型，按语言复用管线；完成文件可在取消后继续使用。"""
    import numpy as np

    total = sum(len(supported_voices(mid)) for mid in MODELS)
    done = sum(prepared_sample(mid, voice) is not None
               for mid in MODELS for voice in supported_voices(mid))
    emit({"type": "progress", "stage": "samples", "done": done, "total": total,
          "label": "正在准备声音试听…"})
    for mid in ("zh", "en"):
        pipelines = {}
        kmodel = None
        for voice in supported_voices(mid):
            sample = prepared_sample(mid, voice)
            if sample:
                emit({"type": "sample-ready", "voiceKey": f"{mid}:{voice}", **sample})
                continue
            emit({"type": "progress", "stage": "samples", "voiceKey": f"{mid}:{voice}",
                  "done": done, "total": total, "label": "正在准备声音试听…"})
            if voice[0] not in pipelines:
                pipelines[voice[0]] = build_pipeline(mid, voice, model=kmodel)
                kmodel = pipelines[voice[0]].model
            text = sample_text(voice)
            root = model_directory(mid)
            if root is None or not voice_ready(mid, voice):
                raise ValueError("声音尚未下载完整，请继续一键准备")
            wav = synth_sentence(pipelines[voice[0]], text, str(root / "voices" / f"{voice}.pt"), 1.0)
            if len(wav) == 0 or not np.isfinite(wav).all():
                raise ValueError("试听音频无效，请重新准备")
            directory = SAMPLE_ROOT / mid
            directory.mkdir(parents=True, exist_ok=True)
            audio = directory / f"{voice}.mp3"
            temporary = directory / f"{voice}.mp3.tmp"
            metadata = directory / f"{voice}.json.tmp"
            try:
                write_mp3(temporary, wav)
                duration = len(wav) / SR
                data = dict(version=SAMPLE_VERSION, revision=MODELS[mid]["revision"], model=mid, voice=voice, text=text,
                            duration=duration, size=temporary.stat().st_size,
                            sha256=hashlib.sha256(temporary.read_bytes()).hexdigest())
                metadata.write_text(json.dumps(data), encoding="utf-8")
                os.replace(temporary, audio)
                os.replace(metadata, directory / f"{voice}.json")
            finally:
                temporary.unlink(missing_ok=True)
                metadata.unlink(missing_ok=True)
            done += 1
            emit({"type": "sample-ready", "voiceKey": f"{mid}:{voice}",
                  "previewAudio": str(audio), "previewDuration": duration})
            emit({"type": "progress", "stage": "samples", "done": done, "total": total,
                  "label": "正在准备声音试听…"})
    emit({"type": "done", "samples": done})


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

    if sum(map(len, paragraphs)) > 10000 or not .8 <= args.speed <= 1.3:
        raise ValueError("文稿须不超过 10000 字，语速须为 0.80–1.30")
    items = prepare_items(paragraphs)
    if not any(sentence for sentence, _ in items):
        raise ValueError("文稿没有可朗读的内容")
    total = len(items)
    emit({"type": "log", "message": f"加载模型 {MODELS[args.model]['name']} ..."})
    emit({"type": "progress", "stage": "load", "done": 0, "total": 0,
          "label": "正在载入声音…"})
    pipe = build_pipeline(args.model, args.voice)
    voice = str(model_directory(args.model) / "voices" / f"{args.voice}.pt")
    emit({"type": "progress", "stage": "synth", "done": 0, "total": total, "label": "声音就绪，开始合成"})

    silence = lambda sec: np.zeros(int(SR * sec), dtype=np.float32)
    pieces = []
    srt_entries = []
    t = 0.0
    for i, (sentence, pause) in enumerate(items, 1):
        wav = synth_sentence(pipe, sentence, voice, args.speed) if sentence else np.empty(0, dtype=np.float32)
        dur = len(wav) / SR
        if sentence:
            if dur <= 0 or not np.isfinite(wav).all():
                raise ValueError("模型返回了无效音频")
            srt_entries.append((t, t + dur, sentence))
        padding = silence(pause)
        t += dur + len(padding) / SR
        pieces.append(wav)
        pieces.append(padding)
        emit({"type": "progress", "stage": "synth", "done": i, "total": total,
              "label": sentence[:60]})

    emit({"type": "progress", "stage": "encode", "done": 0, "total": 1, "label": "编码 MP3 与字幕"})
    full = np.concatenate(pieces)
    result = write_artifacts(Path(args.outdir), args.name, full, SR, srt_entries, "\n\n".join(paragraphs))
    emit({"type": "done", "modelRevision": MODELS[args.model]["revision"], **result})


# ---------------------------------------------------------------- 入口

def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(prog="engine")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check")
    sub.add_parser("list-voices")
    sub.add_parser("prepare-samples")

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
        "prepare-samples": cmd_prepare_samples,
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
