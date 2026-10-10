"""Local-only Qwen Base voice cloning. JSON-lines protocol; no audio network APIs."""
import argparse
import errno
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

from artifacts import safe_name, write_artifacts
from text_processing import fmt_ts, prepare_items
import transcription

REPO = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"
REVISION = "1eccf1cb2519b5a4e8a95b5f0544f3303568164f"
ROOT = Path(os.environ.get("VOICE_STUDIO_HOME", Path.home() / "Library/Application Support/VoiceStudio"))
MODEL = ROOT / "models/qwen3-base-0.6b"

def emit(kind, **data):
    print(json.dumps(dict(type=kind, **data), ensure_ascii=False), flush=True)

def status():
    try:
        version = importlib.metadata.version("mlx-audio")
    except importlib.metadata.PackageNotFoundError:
        version = None
    complete = MODEL / ".complete.json"
    installed = False
    revision = None
    if complete.is_file():
        try:
            manifest = json.loads(complete.read_text())
            if not isinstance(manifest, dict) or not isinstance(manifest.get("files", {}), dict):
                raise ValueError("模型清单无效")
            files = manifest.get("files", {})
            revision = manifest.get("revision")
            installed = bool(files) and all((MODEL / name).is_file() and (MODEL / name).stat().st_size == size
                                            for name, size in files.items())
            if not files:
                installed = (MODEL / "config.json").is_file() and any(MODEL.glob("*.safetensors")) and (MODEL / "speech_tokenizer").is_dir()
            if revision is not None and revision != REVISION:
                installed = False
        except (OSError, ValueError, TypeError):
            pass
    return dict(engine=version, installed=installed, repo=REPO, revision=revision,
                transcriptionInstalled=transcription.installed())

def download():
    if status()["installed"]:
        emit("done", message="声音克隆已准备好")
        return
    # 普通 HTTPS 下载避免部分网络下 Xet 分块重建中断。
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import HfApi, hf_hub_download
    from tqdm.auto import tqdm
    def retry(action):
        for attempt in range(3):
            try:
                return action()
            except Exception as exc:
                if attempt == 2 or isinstance(exc, OSError) and exc.errno == errno.ENOSPC:
                    raise
                emit("log", message="网络传输中断，正在自动继续准备，已完成文件会保留。")
                time.sleep(2 * (attempt + 1))
    info = retry(lambda: HfApi().model_info(REPO, revision=REVISION, files_metadata=True))
    if info.sha != REVISION:
        raise ValueError("声音克隆资源版本不一致，请重新准备")
    files = [f for f in info.siblings if not f.rfilename.startswith(".")]
    total = sum(f.size or 0 for f in files)
    done = 0
    reported = 0
    checksums = {}
    MODEL.mkdir(parents=True, exist_ok=True)
    class DownloadProgress(tqdm):
        def __init__(self, *args, **kwargs):
            self.last_report = 0
            super().__init__(*args, **kwargs)
        def update(self, n=1):
            nonlocal reported
            result = super().update(n)
            now = time.monotonic()
            if now - self.last_report > .5:
                self.last_report = now
                # Hub 可能同时报告下载与重建进度，避免界面百分比倒退。
                current = max(reported, min(total, done + min(f.size or 0, self.n)))
                reported = current
                emit("progress", stage="cloning", done=current, total=total, label=f"正在准备我的声音 {current/1e9:.2f}/{total/1e9:.2f} GB")
            return result
    for f in files:
        emit("progress", stage="cloning", done=done, total=total, label=f"正在准备我的声音 {done/1e9:.2f}/{total/1e9:.2f} GB")
        retry(lambda: hf_hub_download(REPO, f.rfilename, revision=info.sha, local_dir=MODEL, tqdm_class=DownloadProgress))
        if not f.size or (MODEL / f.rfilename).stat().st_size != f.size:
            raise ValueError("声音克隆资源未下载完整，请继续准备")
        lfs = getattr(f, "lfs", None)
        expected_hash = lfs.get("sha256") if lfs else None
        if expected_hash:
            emit("log", message="正在校验已下载的声音克隆资源…")
            with (MODEL / f.rfilename).open("rb") as source:
                checksum = hashlib.sha256()
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    checksum.update(block)
                digest = checksum.hexdigest()
            if digest != expected_hash:
                (MODEL / f.rfilename).unlink()
                raise ValueError("声音克隆资源校验失败，请继续准备")
            checksums[f.rfilename] = digest
        done += f.size or 0
        emit("progress", stage="cloning", done=done, total=total, label=f"正在准备我的声音 {done/1e9:.2f}/{total/1e9:.2f} GB")
    temporary = MODEL / ".complete.tmp"
    temporary.write_text(json.dumps(dict(repo=REPO, revision=info.sha,
                                         files={f.rfilename: f.size for f in files}, sha256=checksums)))
    os.replace(temporary, MODEL / ".complete.json")
    emit("done", message="模型已下载，后续推理离线运行")

def validate(req):
    text = str(req.get("text", "")).strip()
    ref_text = str(req.get("refText", "")).strip()
    reference = Path(req.get("reference", ""))
    if not text or len(text) > 2000:
        raise ValueError("目标文本须为 1–2000 字")
    if not ref_text or len(ref_text) > 1000:
        raise ValueError("请填写所选参考片段的准确逐字稿（1–1000 字）")
    if not reference.is_absolute() or not reference.is_file() or reference.suffix.lower() not in {".wav", ".m4a", ".mp3", ".flac", ".aiff"}:
        raise ValueError("请选择本机 WAV、M4A、MP3、FLAC 或 AIFF 参考录音")
    start, duration = float(req.get("start", 0)), float(req.get("duration", 10))
    if not (0 <= start <= 3600 and 3 <= duration <= 20):
        raise ValueError("参考起点须为 0–3600 秒，长度须为 3–20 秒")
    outdir = Path(req.get("outdir", ""))
    if not outdir.is_absolute() or not outdir.is_dir():
        raise ValueError("请选择存在的导出文件夹")
    return text, ref_text, reference, start, duration, outdir

def timestamp(seconds):
    return fmt_ts(seconds)

def generate(req, ffmpeg):
    text, ref_text, reference, start, duration, outdir = validate(req)
    state = status()
    if state["engine"] != "0.5.8":
        raise ValueError("克隆环境版本不兼容，请在设置中修复至 MLX-Audio 0.5.8")
    if not state["installed"]:
        raise ValueError("请先下载完整 Qwen3-TTS Base 模型")
    if not ffmpeg or not Path(ffmpeg).is_file():
        raise ValueError("未找到本机 FFmpeg，无法转换参考录音")
    # 推理不隐式联网、转写或下载模型。
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import soundfile as sf
    with tempfile.TemporaryDirectory(prefix="voice-studio-clone-") as work:
        wav = Path(work) / "reference.wav"
        subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-threads", "1", "-ss", str(start), "-i", str(reference), "-t", str(duration), "-ac", "1", "-ar", "24000", str(wav)], check=True, timeout=60)
        samples, sr = sf.read(wav)
        if len(samples) < sr * 3 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < 0.001:
            raise ValueError("所选参考片段不足 3 秒、为空或静音，请调整起点")
        emit("progress", stage="load", done=0, total=0, label="正在载入克隆声音…")
        import mlx.core as mx
        from mlx_audio.tts.utils import load_model
        mx.set_cache_limit(256 * 1024 * 1024)
        mx.set_memory_limit(7 * 1024 * 1024 * 1024)
        model = load_model(str(MODEL))
        if model.config.tts_model_type != "base" or not model.speech_tokenizer.has_encoder:
            raise ValueError("模型不是可用的 Base 参考音频克隆模型，已停止")
        items = prepare_items(text.split("\n\n"), max_len=90)
        if not any(sentence for sentence, _ in items):
            raise ValueError("文稿没有可朗读的内容")
        audio, captions, offset = [], [], 0.0
        sample_rate = 24000
        for i, (sentence, pause) in enumerate(items):
            emit("progress", stage="synth", done=i, total=len(items), label=f"生成第 {i+1}/{len(items)} 段")
            if not sentence:
                padding = np.zeros(round(sample_rate * pause), dtype=np.float32)
                audio.append(padding)
                offset += len(padding) / sample_rate
                continue
            chunks = []
            for result in model.generate(text=sentence, ref_audio=str(wav), ref_text=ref_text, lang_code="chinese", max_tokens=600, verbose=False):
                if result.sample_rate != sample_rate:
                    raise ValueError("模型返回了不一致的采样率")
                chunks.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
            if not chunks:
                raise ValueError("模型未返回音频")
            part = np.concatenate(chunks)
            if not np.isfinite(part).all() or len(part) == 0:
                raise ValueError("模型返回了无效音频")
            end = offset + len(part) / sample_rate
            captions.append((offset, end, sentence))
            padding = np.zeros(round(sample_rate * pause), dtype=np.float32)
            audio.extend([part, padding])
            offset = end + len(padding) / sample_rate
            mx.clear_cache()
        emit("progress", stage="encode", done=0, total=0, label="整理音频与字幕…")
        name = safe_name(str(req.get("name") or ("克隆配音-" + time.strftime("%Y%m%d-%H%M%S") + "-" + str(os.getpid()))))
        result = write_artifacts(Path(work), "result", np.concatenate(audio), sample_rate, captions, text, ffmpeg)
        for key, ext in [("wav", "wav"), ("mp3", "mp3"), ("srt", "srt"), ("txt", "txt"), ("captions", "captions.json")]:
            target = outdir / f"{name}.{ext}"
            if target.exists():
                raise ValueError("输出已存在，请使用新的文件名")
            shutil.copy2(result[key], target)
            result[key] = str(target)
        emit("done", modelRevision=state["revision"], **result)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "download", "generate"])
    parser.add_argument("--request")
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    try:
        if args.command == "status":
            emit("status", **status())
        elif args.command == "download":
            download()
            transcription.download()
            emit("done", message="声音克隆与文字识别资源已准备好")
        else:
            generate(json.loads(Path(args.request).read_text()), args.ffmpeg)
    except Exception as exc:
        emit("error", message=str(exc))
        sys.exit(1)
