# 本机声音克隆

在声音库点击「克隆声音」，确认授权后点击「导入并识别」。应用自动读取前 20 秒并识别片段文字，用户试听、校正并确认后命名保存。可调整 3–20 秒选段，重新读取时同步重新识别；识别失败或取消可重试，或试听后手动补全。保存后可在统一工作台生成配音，并导出 WAV/MP3/SRT/TXT 文件。

仅 Apple Silicon macOS 支持 MLX 克隆与识别；原 Kokoro 跨平台功能保留。需要本机 FFmpeg，优先使用 uv。克隆与识别复用 runtime/clone-venv。克隆模型位于 ~/Library/Application Support/VoiceStudio/models/qwen3-base-0.6b；识别模型使用 Qwen3-ASR 0.6B 4-bit，固定 revision 313d850181767edf09f00a9c289becca70e58cd0，位于 models/qwen3-asr-0.6b-4bit，约 713 MB。下载可续传，完成标记只在完整性校验后写入。仅模型文件下载联网，参考片段在本机自动转写，合成使用用户校验后的文字；不调用远程推理、不上传录音。字幕按逐句实际音频长度生成。

同一应用进程中的安装、下载、Kokoro 推理和克隆任务互斥。克隆可取消；任务结束即退出 Python 进程，释放模型。取消下载保留缓存，便于续传。取消推理不发布未完成的结果。

参考录音仅应使用本人或已获授权的声音。自动识别不能代替参考文字和生成发音的人工核对。

## 来源与许可

- MLX-Audio 0.5.8，MIT：https://github.com/Blaizzy/mlx-audio
- Qwen3-TTS-12Hz-0.6B-Base，Apache-2.0：https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base
- MLX 官方社区转换版，Apache-2.0：https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16
- 已下载转换版 revision：1eccf1cb2519b5a4e8a95b5f0544f3303568164f，文件合计 2,516,141,490 字节。

上述许可证允许商业使用，分发代码或权重时须遵守各自版权、许可证及 NOTICE 等保留要求。本次未发布或分发模型。
