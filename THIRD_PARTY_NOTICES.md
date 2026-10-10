# 第三方项目与模型

vovo 自有代码采用 [MIT License](LICENSE)。第三方代码、模型、声音资源和运行时工具仍遵循各自的许可证，不因 vovo 的许可证而改变。

## 应用依赖

- [Tauri 2 与官方插件](https://github.com/tauri-apps/tauri)：MIT / Apache-2.0，见上游许可文件。
- [React](https://github.com/facebook/react/blob/main/LICENSE)：MIT。
- [Kokoro](https://github.com/hexgrad/kokoro/blob/main/LICENSE)：Apache-2.0，负责预设配音。
- [MLX-Audio](https://github.com/Blaizzy/mlx-audio/blob/v0.5.8/LICENSE)：MIT，负责 Apple Silicon 上的本地声音克隆与识别。
- [lameenc](https://github.com/chrisstaite/lameenc)：LGPL-3.0，预设配音的 MP3 编码器；其中 LAME 的许可证见上游项目。
- [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)：BSD-2-Clause，缺少 FFmpeg 时用于取得运行时工具；其中 FFmpeg 二进制遵循其自身许可。

完整的直接与间接依赖版本以 `package-lock.json`、`src-tauri/Cargo.lock` 和应用安装的 Python 包元数据为准；上表列出主要组件。

## 运行时下载的模型

本仓库不包含模型权重。应用首次准备时下载以下模型及对应的配置和声音资源：

| 模型 | 来源 | 许可证 |
| --- | --- | --- |
| Kokoro v1.0 | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | Apache-2.0 |
| Kokoro v1.1-zh | [hexgrad/Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) | Apache-2.0 |
| Qwen3-TTS 0.6B Base | [Qwen 官方项目](https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE)、[MLX 社区转换版](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) | Apache-2.0 |
| Qwen3-ASR 0.6B | [Qwen 官方项目](https://github.com/QwenLM/Qwen3-ASR/blob/main/LICENSE)、[MLX 社区 4-bit 转换版](https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-4bit) | Apache-2.0 |

模型来源与固定 revision 见 `src-tauri/resources/engine.py`、`clone_engine.py` 和 `transcription.py`。重新分发模型时需随附其许可及适用的上游声明。

## FFmpeg

FFmpeg 是运行时音频工具，源码仓库不随附 FFmpeg 二进制。具体二进制的许可证取决于其构建选项，可能包含 LGPL 或 GPL 组件；参见 [FFmpeg 官方许可说明](https://ffmpeg.org/legal.html)。重新分发包含 FFmpeg 的应用或运行时包时，应按实际构建的许可保留声明并提供所需的对应源码。

## 参考录音

用户导入的参考录音、逐字稿和生成产物不是本项目的开源资产。使用「我的声音」前需确认这是本人声音，或已获得声音本人的明确授权。
