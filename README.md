# 配音工坊（VoiceStudio）

本地优先的语音创作应用。直接编辑文稿，选择预设或自己的声音，生成配音与句级字幕，再导出给剪辑工具或分享。

使用 **Tauri 2 + React + Rust + Python**。预设配音面向 macOS / Windows / Linux；当前本地声音克隆仅支持 **Apple Silicon Mac**。

## 四个独立区域

- **生成工作台**：直接输入、粘贴、导入文稿，选择声音，调整有效合成语速，试听选段并生成。草稿自动保存，环境未安装也可以编辑。
- **声音库**：搜索、语言/模型筛选、收藏、最近使用；通过「参考录音 → 核对片段与文字 → 命名保存」创建私有克隆声音。
- **生成记录**：保留每次成功生成的文稿、声音、音频和字幕；可以再次播放、校对字幕、使用原文稿或重新导出。
- **设置**：一键准备配音、所有声音试听及本机支持的声音克隆；设置导出位置与格式、管理文稿试听缓存、切换外观及查看诊断信息。

低频配置不占据工作台。当前任务的声音、模型选择和语速仍留在创作流程中。

## 声音与输出

| 模型 | 应用提供的声音 | 合成语速 | 平台 |
| --- | --- | --- | --- |
| Kokoro v1.0 | 28 个美式/英式英语声音 | 0.80–1.30× | macOS / Windows / Linux |
| Kokoro v1.1-zh | 100 个中文声音 + 3 个英文声音 | 0.80–1.30× | macOS / Windows / Linux |
| Qwen3-TTS 0.6B Base / MLX-Audio 0.5.8 | 使用授权参考录音保存的「我的声音」 | 不提供无效合成语速控件 | Apple Silicon Mac |

- 生成先在应用目录保存完整产物组：**WAV、MP3（160 kbps）、SRT、TXT 与字幕元数据**，不要求先选择导出文件夹。
- 默认导出 **MP3 + SRT**，另可选择 WAV / TXT，或开启生成后自动导出。
- 每次导出创建独立版本文件夹，避免覆盖已有文件。更换格式、校对字幕与再次导出不重新推理。
- 使用文件流播放音频；播放器的倍速只影响试听，不改变导出的文件。
- SRT 是按各段实际音频长度累计的**句级字幕**，并非词级精确对齐。支持同步预览、定位和文字校对；修改字幕不会改变朗读内容。
- 支持 `【停顿:1秒】`、`[pause:1]`、`[Pause...]` 等显式停顿，范围 0.1–10 秒。普通括号内容不会被删除。
- 「一键准备全部」依次检查配音环境、复用并下载缺失的声音资源、提前生成全部 131 个预设声音的试听，最后准备本机支持的声音克隆及已有私有声音的试听。
- 声音库显示「可播放」「准备中」「等待准备」「待准备」。已完成的试听直接播放文件，后台准备期间也可播放；点击预设试听不会临时载入模型或生成。
- 准备可取消后继续；已校验的模型文件与已完成试听不会重复下载或合成。试听按固定模型版本、示例文本和音频校验值验证，损坏或过期文件会重新准备。
- 文稿支持 TXT、Markdown、DOCX。TXT/MD 不依赖语音环境；DOCX 需要文档解析依赖。

Kokoro v1.0 的完整上游目录含 54 个音色，但本应用目前只暴露已接入的英语声音，不把上游语言范围当成应用已验证能力。

## 本地声音克隆

在声音库点击「克隆声音」，导入 WAV / M4A / MP3 / FLAC / AIFF：

1. 独立确认本人声音或已获得明确授权。
2. 点击「导入并识别」，自动读取录音前 20 秒并在本机识别文字；试听、校正错字或漏字，勾选确认后继续。可展开「调整参考片段」选择 3–20 秒人声，重新读取会重新识别对应片段。
3. 命名并保存；可以先试听短句，保存时也会自动准备声音示例，之后直接播放。

保存的是应用管理的参考片段与文字，**不是训练一套专属模型**。以后使用不依赖原始录音文件；资料默认只保存在本机，不会上传。首次使用先完成一键准备，录音与试听随声音一起保存。

文字识别复用 MLX-Audio 0.5.8，使用固定版本的 Qwen3-ASR 0.6B 4-bit（约 713 MB）。一键准备会下载识别资源；已有克隆环境首次导入时也会自动补齐。下载仅获取模型文件，后续识别离线进行。失败或取消时保留可试听片段，支持重试和手动校正。

详细模型背景与原有验证记录见 [CLONING.md](CLONING.md)。

## 开发与构建

建议使用 Node.js 22.18+、Rust stable，以及平台所需的 Tauri 构建依赖。语音环境由应用创建；推荐安装 [uv](https://docs.astral.sh/uv/)，也可通过系统 Python 创建隔离环境。缺少 FFmpeg 时，一键准备会通过固定版本的 imageio-ffmpeg wheel 将音频工具安装到克隆环境中，不修改系统配置。

```bash
npm install
npm run tauri dev
```

只预览界面：

```bash
npm run dev
```

网页预览支持编辑、导入 TXT/MD、声音目录、收藏、主题与草稿保存；真实语音生成、文件导出和克隆需要桌面应用，不使用模拟音频冒充生成结果。

```bash
npm run build
npm run tauri build
```

### 更新本机应用

修改代码后，在项目目录运行：

```bash
./update.sh
# 或
npm run update:local
```

也可以在 Finder 中双击 `update.command`。脚本会自动定位项目目录，准备缺少或已变更的项目依赖，构建、签名后更新 `/Applications/VoiceStudio.app`，再重新打开。构建、复制或验签失败时保留原应用；旧版未能正常退出时停止替换。

模型、声音、文稿、导出记录和设置继续使用现有数据目录，不重新下载模型。

```bash
./update.sh --no-open                            # 只更新，不打开
./update.sh "$HOME/Applications/VoiceStudio.app" # 自定义安装位置
```

本机更新需要 Node.js 22.18+、Rust 和 Xcode Command Line Tools；不需要重新安装配音环境。脚本使用本机签名，适用于这台 Mac 的开发更新。

macOS 需要 Xcode Command Line Tools；Windows 需要 WebView2；Linux 需要 WebKitGTK 等依赖。Ubuntu/Debian 示例：

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## 测试

```bash
# 前端数据校验与浏览器流程（默认使用本机 Google Chrome）
npm test

# 后端锁、取消、文件范围、字幕校验、产物导出
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings

# 共享文本、资源完整性、原有克隆校验及音频产物/FFmpeg 测试
uv run --no-project --with numpy --with soundfile --with lameenc --with tqdm \
  python -B -m unittest discover -s src-tauri/resources -p 'test_*.py' -v
```

没有 Chrome 时可先运行 `npx playwright install chrome`，或将 `playwright.config.ts` 改为已安装的 Chromium。浏览器中涉及桌面生成的测试**明确模拟 IPC**，不是模型音质或桌面端到端推理验证。

## 数据位置

| 平台 | 应用数据目录 |
| --- | --- |
| macOS | `~/Library/Application Support/VoiceStudio` |
| Windows | `%APPDATA%\VoiceStudio` |
| Linux | `$XDG_DATA_HOME/VoiceStudio`，默认 `~/.local/share/VoiceStudio` |

目录内包含：

- `runtime/venv`：预设配音环境；`runtime/clone-venv`：独立克隆环境。
- `models/kokoro/{en,zh}`、`models/qwen3-base-0.6b`：固定 revision 的模型资源。
- `voices`：私有声音与应用管理的参考录音。
- `references`：声音向导尚未保存的片段。
- `artifacts`：每次正式生成的完整产物与版本化 JSON 清单。
- `samples/{zh,en}`：预先准备好的声音库试听及完整性元数据，清理文稿试听时保留。
- `previews`：文稿选段的试听缓存，可在设置中清理。

预设模型兼容已有、对应 revision 的 Hugging Face 快照；移除应用模型不会删除其他程序共用的缓存。草稿、收藏、最近使用和界面偏好保存在 WebView 的本地存储中。

## 主要代码

- `src/App.tsx`、`src/components/`：四区界面、声音向导、播放器与字幕。
- `src/catalog.ts`、`src/domain.ts`、`src/hooks/useJobs.ts`：无环境可浏览的声音目录、草稿校验与任务协调。
- `src-tauri/src/jobs.rs`：后端互斥、任务编号、递增事件与进程树取消。
- `src-tauri/src/setup.rs`：一个任务完成环境、声音资源、全部试听与声音克隆准备。
- `src-tauri/src/studio.rs`：声音、参考录音、产物保存、字幕版本与导出。
- `src-tauri/resources/engine.py`、`clone_engine.py`：预设与克隆适配器。
- `src-tauri/resources/text_processing.py`、`artifacts.py`：共享切句、停顿、字幕与音频产物。

完整设计取舍见 [产品重设计方案](docs/PRODUCT_REDESIGN.md)，实施范围与待验证事项见 [实施状态](docs/IMPLEMENTATION.md)。

## 许可与来源

Kokoro 与 Qwen3-TTS 模型采用 Apache 2.0，仍需遵守各依赖及模型的完整许可。预设 MP3 编码使用 lameenc；克隆的参考录音处理和 MP3 编码使用本机 FFmpeg。使用声音克隆前请确认授权，不冒充他人或侵害声音权利。
