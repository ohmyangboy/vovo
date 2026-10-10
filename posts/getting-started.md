---
title: 安装与使用
date: 2026-10-10
published: true
description: 从源码运行 vovo，准备本地配音资源，生成并导出第一段配音。
---

**【WIP】这是一个构建中的项目，功能与体验仍在持续完善。**

## 从源码开始

当前可以从 [GitHub](https://github.com/ohmyangboy/vovo) 获取源码运行。需要 Node.js 22.18+、Rust stable 和所在平台的 Tauri 构建依赖；macOS 还需要 Xcode Command Line Tools。

```bash
git clone https://github.com/ohmyangboy/vovo.git
cd vovo
npm install
npm run tauri dev
```

完整的平台依赖和构建说明见 [项目 README](https://github.com/ohmyangboy/vovo#开发与构建)。

预设配音面向 macOS、Windows 与 Linux；本地声音克隆目前仅支持 Apple Silicon Mac。

## 第一段配音

1. 打开「设置」，点击「检查并准备」，下载所需资源。首次准备需要联网，完成后可以离线使用。
2. 回到「生成工作台」，输入文稿，选择声音与语速。
3. 先试听文稿，确认后点击「生成配音」。
4. 播放结果，按需校对字幕，再导出。默认导出 MP3 + SRT，也可选择 WAV / TXT。

生成结果保存在本机记录中。再次导出或调整导出格式不需要重新生成；字幕是句级时间轴，修改字幕文字不会改变朗读内容。

## 创建我的声音

在声音选择中点击「创建我的声音」，先确认声音授权，再导入 WAV、MP3、M4A、FLAC 或 AIFF 录音。

选择 3–20 秒清晰人声，避免背景音乐；核对识别文字后命名并保存。朗读英文时，英文参考录音更合适。录音与文字默认保存在本机，保存后不依赖原始录音文件。

## 只看界面

```bash
npm run dev
```

网页预览可以编辑文稿、浏览声音目录和保存草稿。真实配音、声音克隆与文件导出需要桌面应用。

[查看完整项目说明](https://github.com/ohmyangboy/vovo#readme) · [反馈问题](https://github.com/ohmyangboy/vovo/issues)
