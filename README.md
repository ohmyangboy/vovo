# 配音工坊（VoiceStudio）

跨平台本地 TTS 配音工具：把文稿转成 **MP3 配音 + SRT 字幕**，全程本地推理。
支持 **macOS / Windows / Linux**，界面按平台自适应（macOS 原生质感 / Windows 11 Fluent / Linux Adwaita）。

## 功能

- 导入 `txt` / `md` / `docx`（也支持拖拽到窗口），或直接输入 / 粘贴文本
- 两套本地模型，音色可试听：
  - **英文**：Kokoro v1.0（54 个音色，美音 / 英音 / 多语言）
  - **中英双语**：Kokoro v1.1-zh（100 个中文音色 + 3 个英文音色）
- 语速调节（0.80 – 1.30）
- 一键生成 `.mp3`（24kHz / 96kbps）+ `.srt` 字幕（按句切分，毫秒级精确）
- `[Pause...]`、`【停顿】` 等舞台指示自动转为停顿
- 首次安装后完全离线可用；模型可随时在应用内下载 / 删除

## 技术栈

- **外壳**：Tauri 2（Rust）+ 系统 WebView —— 安装包小、内存占用低、三平台原生窗口
- **前端**：React + TypeScript + 平台自适应 CSS 设计系统
- **引擎**：`src-tauri/resources/engine.py`（Python，Kokoro + PyTorch CPU 推理）

## 运行与构建

### 前置

- Node.js 18+、Rust 1.77+（[rustup.rs](https://rustup.rs)）
- Python 3.10+ 或 [uv](https://docs.astral.sh/uv/)（用于创建引擎环境，应用会引导安装）

### 开发

```bash
npm install
npm run tauri dev
```

### 打包

```bash
npm run tauri build
```

产物：

| 平台 | 位置 | 说明 |
| --- | --- | --- |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` | 需要 Xcode Command Line Tools |
| Windows | `src-tauri/target/release/bundle/msi/*.msi` | 需要 WebView2（Win10/11 自带） |
| Linux | `src-tauri/target/release/bundle/deb/*.deb` | 需要 `libwebkit2gtk-4.1-dev` 等依赖 |

Linux 系统依赖（Ubuntu/Debian）：

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### 应用目录

引擎安装在用户数据目录，模型缓存在 Hugging Face 默认缓存：

| 平台 | 引擎环境 | 模型缓存 |
| --- | --- | --- |
| macOS | `~/Library/Application Support/VoiceStudio/runtime/venv` | `~/.cache/huggingface` |
| Windows | `%APPDATA%\VoiceStudio\runtime\venv` | `%USERPROFILE%\.cache\huggingface` |
| Linux | `~/.local/share/VoiceStudio/runtime/venv` | `~/.cache/huggingface` |

## 目录结构

```
voice-studio-app/
├── src/                    # React 前端
│   ├── components/         # 界面组件（文稿 / 设置 / 生成 / 安装）
│   ├── api.ts              # Tauri 命令封装
│   ├── App.tsx             # 主逻辑与状态
│   └── styles.css          # 平台自适应设计系统
├── src-tauri/
│   ├── src/lib.rs          # Rust 后端（引擎管理 + 流式进度）
│   ├── resources/engine.py # Python 引擎（三平台共用）
│   └── tauri.conf.json
└── package.json
```

## 引擎单独使用（调试）

```bash
# macOS 示例路径，Windows/Linux 见上表
PY="$HOME/Library/Application Support/VoiceStudio/runtime/venv/bin/python3"
"$PY" src-tauri/resources/engine.py check
"$PY" src-tauri/resources/engine.py list-voices
"$PY" src-tauri/resources/engine.py generate --model en --voice af_heart \
      --input paragraphs.json --outdir ~/Desktop --name 配音 --speed 1.0
```

## 与 macOS 原生版的关系

`../VoiceStudio/` 是早期的 SwiftUI 原生版本（仅 macOS），保留可用；
本目录是跨平台主线，两者共用同一个 Python 引擎（`engine.py`）。

## 许可与来源

- Kokoro-82M / Kokoro-82M-v1.1-zh：Apache 2.0（hexgrad）
- 推理：kokoro + PyTorch；MP3 编码：lameenc（无需 ffmpeg）
