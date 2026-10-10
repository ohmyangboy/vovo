# vovo

**【WIP】这是一个构建中的项目，功能与体验仍在持续完善。**

本地优先的语音创作应用。直接编辑文稿，选择预设或自己的声音，生成配音与句级字幕，再导出给剪辑工具或分享。

使用 **Tauri 2 + React + Rust + Python**。预设配音面向 macOS / Windows / Linux；当前本地声音克隆仅支持 **Apple Silicon Mac**。

## 四个独立区域

- **生成工作台**：直接输入、粘贴、导入文稿，选择声音，调整有效合成语速，试听选段并生成。草稿自动保存，环境未安装也可以编辑。
- **声音选择**：从工作台顶部进入，统一搜索、语言筛选、收藏和最近使用；在这里创建、管理自己的声音，也可给已有声音补充参考录音。
- **生成记录**：成功生成后立即加入左侧列表；点击即可播放、校对字幕、继续编辑或重新导出。浏览记录不会替换工作台的草稿。
- **设置**：一键准备配音、所有声音试听及本机支持的声音克隆；设置导出位置与格式、管理文稿试听缓存、切换外观及查看诊断信息。

工作台保持一页：顶栏集中品牌和设置，文稿只在编辑区内滚动，固定底栏整合试听、生成结果播放、字幕入口、导出和生成。声音决定对应的配音方式，无需另选模型。导入、停顿和清空放在「更多」菜单；资源配置留在设置中。

## 声音与输出

| 模型 | 应用提供的声音 | 合成语速 | 平台 |
| --- | --- | --- | --- |
| Kokoro v1.0 | 28 个美式/英式英语声音 | 0.80–1.30× | macOS / Windows / Linux |
| Kokoro v1.1-zh | 100 个中文声音 + 3 个英文声音 | 0.80–1.30× | macOS / Windows / Linux |
| Qwen3-TTS 0.6B Base / MLX-Audio 0.5.8 | 使用授权参考录音保存的「我的声音」 | 0.80–1.30×，保持音高的输出变速 | Apple Silicon Mac |

- 生成先在应用目录保存完整产物组：**WAV、MP3（160 kbps）、SRT、TXT 与字幕元数据**，不要求先选择导出文件夹。
- 默认导出 **MP3 + SRT**，另可选择 WAV / TXT，或开启生成后自动导出。
- 每次导出创建独立版本文件夹，避免覆盖已有文件。更换格式、校对字幕与再次导出不重新推理。
- 使用文件流播放音频；播放器的倍速只影响试听，不改变导出的文件。
- 声音示例的进度条直接显示在对应声音卡片中，文稿试听与正式配音共用工作台底栏播放器；没有额外的浮动播放器或文稿下方的结果卡片。关闭选声、切换页面或开始另一段播放时停止原试听。
- 字幕从底栏按需打开，可校对、保存或点击时间跳转；导出位置、格式与文件夹入口收在底栏的「更多」菜单。
- 点击导出复用默认位置与格式；「文件与导出选项」可更换，导出失败也可重新选择位置。
- SRT 是按各段实际音频长度累计的**句级字幕**，并非词级精确对齐。支持同步预览、定位和文字校对；修改字幕不会改变朗读内容。
- 支持 `【停顿:1秒】`、`[pause:1]`、`[Pause...]` 等显式停顿，范围 0.1–10 秒。普通括号内容不会被删除。
- 「一键准备全部」依次检查配音环境、复用并下载缺失的声音资源、提前生成全部 131 个预设声音的试听，最后准备本机支持的声音克隆及已有私有声音的试听。
- 声音库显示「可播放」「准备中」「等待准备」「待准备」。已完成的试听直接播放文件，后台准备期间也可播放；点击预设试听不会临时载入模型或生成。
- 准备可取消后继续；已校验的模型文件与已完成试听不会重复下载或合成。试听按固定模型版本、示例文本和音频校验值验证，损坏或过期文件会重新准备。
- 文稿支持 TXT、Markdown、DOCX。TXT/MD 不依赖语音环境；DOCX 需要文档解析依赖。

Kokoro v1.0 的完整上游目录含 54 个音色，但本应用目前只暴露已接入的英语声音，不把上游语言范围当成应用已验证能力。

## 本地声音克隆

在工作台顶部选择声音，点击「创建我的声音」，导入 WAV / M4A / MP3 / FLAC / AIFF：

1. 独立确认本人声音或已获得明确授权。
2. 点击「导入录音并识别文字」，自动读取录音前 20 秒并在本机识别文字；试听、校正错字或漏字，勾选确认。可展开「调整录音片段」选择 3–20 秒人声，重新读取会重新识别对应片段。
3. 命名并保存；可以先试听短句，保存时也会自动准备声音示例，之后直接播放。

保存的是应用管理的参考片段与文字，**不是训练一套专属模型**。以后使用不依赖原始录音文件；资料默认只保存在本机，不会上传。首次使用先完成一键准备，录音与试听随声音一起保存。

已有声音的「管理声音 → 补充参考录音」可再保留两段录音，总共最多三段。朗读英文优先选英文参考，中文优先选中文参考，同语言优先选最近补充的录音；中英混读或没有匹配片段时使用原录音。这是参考片段选择，不是多段融合或增量训练。清晰的录音、准确逐字稿、与目标语言和表达相符的自然朗读，比反复识别同一段更有帮助。

克隆按文稿检测中文、英文或混读，英文长句不再每 90 字切开。只在实际句末、段落或显式停顿处补短间隔；过长片段拆分时不额外插入固定静音。克隆语速通过 FFmpeg `atempo` 改变最终音频，字幕时间同步缩放。当前 Base 模型不提供可靠的文字语气指令，语气主要跟随参考录音。

文字识别复用 MLX-Audio 0.5.8，使用固定版本的 Qwen3-ASR 0.6B 4-bit（约 713 MB）。一键准备会下载识别资源；已有克隆环境首次导入时也会自动补齐。下载仅获取模型文件，后续识别离线进行。失败或取消时保留可试听片段，支持重试和手动校正。

详细模型背景与原有验证记录见 [CLONING.md](CLONING.md)。

## 开发与构建

建议使用 Node.js 22.18+、Rust stable，以及平台所需的 Tauri 构建依赖。语音环境由应用创建；推荐安装 [uv](https://docs.astral.sh/uv/)，也可通过系统 Python 创建隔离环境。缺少 FFmpeg 时，一键准备会通过固定版本的 imageio-ffmpeg wheel 将音频工具安装到克隆环境中，不修改系统配置。

```bash
git clone https://github.com/ohmyangboy/vovo.git
cd vovo
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

也可以在 Finder 中双击 `update.command`。脚本会自动定位项目目录，准备缺少或已变更的项目依赖，构建、签名后更新 `/Applications/vovo.app`，再重新打开。构建、复制或验签失败时保留原应用；旧版未能正常退出时停止替换。

模型、声音、文稿、导出记录和设置继续使用现有数据目录，不重新下载模型。

从旧版升级时，脚本在新版安装成功后清理同一安装目录内的旧 `VoiceStudio.app`。首次启动 vovo 会迁移应用数据与 WebView 偏好；如果新版已经有数据，会保留它们，不覆盖。

```bash
./update.sh --no-open                            # 只更新，不打开
./update.sh "$HOME/Applications/vovo.app" # 自定义安装位置
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
| macOS | `~/Library/Application Support/vovo` |
| Windows | `%APPDATA%\vovo` |
| Linux | `$XDG_DATA_HOME/vovo`，默认 `~/.local/share/vovo` |

目录内包含：

- `runtime/venv`：预设配音环境；`runtime/clone-venv`：独立克隆环境。
- `models/kokoro/{en,zh}`、`models/qwen3-base-0.6b`：固定 revision 的模型资源。
- `voices`：私有声音与应用管理的参考录音。
- `references`：声音向导尚未保存的片段。
- `artifacts`：每次正式生成的完整产物与版本化 JSON 清单。
- `samples/{zh,en}`：预先准备好的声音库试听及完整性元数据，清理文稿试听时保留。
- `previews`：文稿选段的试听缓存，可在设置中清理。

预设模型兼容已有、对应 revision 的 Hugging Face 快照；移除应用模型不会删除其他程序共用的缓存。草稿、收藏、最近使用和界面偏好保存在 WebView 的本地存储中。

旧版 `VoiceStudio` 数据在首次启动时迁入 `vovo`，旧路径保留一个兼容链接，让虚拟环境和历史声音记录继续可用，模型没有第二份副本。macOS 的旧 WebView 存储保留用于回退，新版使用 `local.vovo` 和 `vovo.*.v1` 存储键。原有自选导出目录继续保留。Windows 若没有符号链接权限，会继续复用旧数据目录；新安装使用上表中的 vovo 目录。发现两份独立数据目录时停止迁移并保留全部文件。

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

vovo 自有代码采用 [MIT License](LICENSE)，欢迎使用、修改和贡献。主要第三方组件、模型来源与运行时工具的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。使用声音克隆前请确认授权，不冒充他人或侵害声音权利。

产品介绍页面使用 Paper Blog CLI 的本地项目模式：在项目根目录执行 `paper -l serve`。Markdown 位于 `posts/`，静态构建输出到 `out/`，详见 [网站说明](docs/WEBSITE.md)。
