"""Transcribe only the prepared local reference; network is used for model files only."""
import argparse
import errno
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time
import wave

REPO = "mlx-community/Qwen3-ASR-0.6B-4bit"
REVISION = "313d850181767edf09f00a9c289becca70e58cd0"
ROOT = Path(os.environ.get("VOICE_STUDIO_HOME", Path.home() / "Library/Application Support/VoiceStudio"))
MODEL = ROOT / "models/qwen3-asr-0.6b-4bit"
FILES = {
    "chat_template.json", "config.json", "generation_config.json", "merges.txt",
    "model.safetensors", "model.safetensors.index.json", "preprocessor_config.json",
    "tokenizer_config.json", "vocab.json",
}


def emit(kind, **data):
    print(json.dumps(dict(type=kind, **data), ensure_ascii=False), flush=True)


def installed():
    try:
        manifest = json.loads((MODEL / ".complete.json").read_text())
        files = manifest["files"]
        return (manifest["repo"] == REPO and manifest["revision"] == REVISION
                and isinstance(files, dict) and set(files) == FILES
                and all(isinstance(size, int) and size > 0 and (MODEL / name).is_file()
                        and (MODEL / name).stat().st_size == size for name, size in files.items()))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def download():
    if installed():
        return
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
                emit("log", message="识别资源下载中断，正在重试；已下载文件会保留。")
                time.sleep(2 * (attempt + 1))

    emit("progress", stage="transcription-resources", label="首次使用，正在准备文字识别资源…")
    info = retry(lambda: HfApi().model_info(REPO, revision=REVISION, files_metadata=True))
    files = [file for file in info.siblings if file.rfilename in FILES]
    if info.sha != REVISION or {file.rfilename for file in files} != FILES:
        raise ValueError("文字识别资源版本或文件清单不完整，请重新识别")
    if any(not file.size for file in files):
        raise ValueError("文字识别资源大小无效，请重新识别")
    total = sum(file.size for file in files)
    done = reported = 0
    sizes, checksums = {}, {}
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
                reported = max(reported, min(total, done + min(file.size, self.n)))
                emit("progress", stage="transcription-resources", done=reported, total=total,
                     label="正在准备文字识别资源…")
            return result

    for file in files:
        emit("progress", stage="transcription-resources", done=done, total=total,
             label="正在准备文字识别资源…")
        retry(lambda: hf_hub_download(REPO, file.rfilename, revision=REVISION,
                                     local_dir=MODEL, tqdm_class=DownloadProgress))
        path = MODEL / file.rfilename
        if not path.is_file() or path.stat().st_size != file.size:
            raise ValueError("文字识别资源未下载完整，请重新识别以继续下载")
        lfs = getattr(file, "lfs", None)
        expected_hash = lfs.get("sha256") if lfs else None
        if expected_hash:
            checksum = hashlib.sha256()
            with path.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    checksum.update(block)
            digest = checksum.hexdigest()
            if digest != expected_hash:
                path.unlink()
                raise ValueError("文字识别资源校验失败，请重新识别")
            checksums[file.rfilename] = digest
        sizes[file.rfilename] = file.size
        done += file.size
    marker = MODEL / ".complete.tmp"
    marker.write_text(json.dumps(dict(repo=REPO, revision=REVISION, files=sizes, sha256=checksums)))
    os.replace(marker, MODEL / ".complete.json")


def validate_audio(audio):
    path = Path(audio)
    if not path.is_absolute() or not path.is_file() or path.suffix.lower() != ".wav":
        raise ValueError("请先读取本机参考片段，再识别文字")
    try:
        with wave.open(str(path), "rb") as source:
            duration = source.getnframes() / source.getframerate()
            if (source.getnchannels() != 1 or source.getsampwidth() != 2
                    or source.getframerate() != 24000 or not 3 <= duration <= 20.01):
                raise ValueError("请使用已准备好的 3–20 秒参考片段")
    except (wave.Error, EOFError) as exc:
        raise ValueError("参考片段无法读取，请重新导入") from exc
    return path


def transcribe(audio):
    path = validate_audio(audio)
    try:
        version = importlib.metadata.version("mlx-audio")
    except importlib.metadata.PackageNotFoundError:
        version = None
    if version != "0.5.8":
        raise ValueError("文字识别环境尚未准备，请在设置中一键准备全部")
    download()
    # 用本机路径加载完整资源，音频不会发送到任何远程识别服务。
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import mlx.core as mx
    from mlx_audio.stt.utils import load_model
    mx.set_cache_limit(256 * 1024 * 1024)
    mx.set_memory_limit(4 * 1024 * 1024 * 1024)
    emit("progress", stage="transcription", label="正在识别片段文字…")
    model = load_model(MODEL)
    result = model.generate(audio=str(path), max_tokens=512, temperature=0.0, verbose=False)
    text = result.text.strip()
    if not text:
        raise ValueError("没有识别到清晰的人声，请重新选段，或试听后补全文字")
    if len(text) > 1000:
        raise ValueError("识别文字异常过长，请重新选一个清晰片段")
    emit("done", text=text, modelRevision=REVISION)
    return text


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["download", "transcribe"])
    parser.add_argument("--audio")
    args = parser.parse_args()
    try:
        if args.command == "download":
            download()
            emit("done", message="文字识别资源已准备好")
        else:
            transcribe(args.audio or "")
    except Exception as exc:
        emit("error", message=str(exc))
        sys.exit(1)
