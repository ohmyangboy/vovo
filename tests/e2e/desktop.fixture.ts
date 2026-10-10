import type { Page } from "@playwright/test";

export async function openVoicePicker(page: Page) {
  await page.getByRole("button", { name: "生成工作台", exact: true }).click();
  await page.locator(".compose-voice").click();
}

// 只模拟 IPC 与媒体文件，验证界面流程；不冒充真实语音推理。
export async function desktopFixture(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as Record<string, any>;
    let next = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const history: any[] = [];
    const previews: any[] = [];
    const voices: any[] = [];
    const state = {
      mode: "success",
      prepareMode: "success",
      transcriptionMode: "success",
      transcriptionText: "这是参考录音里面实际说的话。",
      preparedKeys: ["zh:zf_001", "en:af_heart"],
      includePendingVoices: false,
      savedVoices: voices,
      records: history,
      completePrepare: null as (() => void) | null,
      calls: [] as { command: string; args: any }[],
      pending: null as ((error: string) => void) | null,
    };
    target.__STUDIO_TEST__ = state;
    target.isTauri = true;
    const bytes = new Uint8Array(44 + 24000 * 3 * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++)
        bytes[offset + i] = text.charCodeAt(i);
    };
    ascii(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, bytes.length - 44, true);
    const audio = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const emit = (payload: Record<string, unknown>) => {
      for (const [id, listener] of listeners) {
        if (listener.event === "studio-event")
          callbacks.get(listener.handler)?.({
            id,
            event: "studio-event",
            payload,
          });
      }
    };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => listeners.delete(id),
    };
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback: (callback: (event: unknown) => void) => {
        const id = ++next;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: () => audio,
      invoke: async (command: string, args: any = {}) => {
        state.calls.push({ command, args });
        switch (command) {
          case "plugin:event|listen": {
            const id = ++next;
            listeners.set(id, { event: args.event, handler: args.handler });
            return id;
          }
          case "plugin:event|unlisten":
            listeners.delete(args.eventId);
            return;
          case "platform_info":
            return { os: "macos", arch: "aarch64" };
          case "check_env":
            return { installed: true, ready: true };
          case "clone_status":
            return {
              supported: true,
              engine: "0.5.8",
              installed: true,
              ffmpeg: true,
              transcriptionInstalled: true,
            };
          case "list_voices":
            return {
              models: [
                {
                  id: "zh",
                  name: "中文配音",
                  desc: "",
                  installed: true,
                  sizeMB: 400,
                  voices: [
                    {
                      id: "zf_001",
                      group: "中文 · 女声",
                      label: "",
                      ready: true,
                      ...(state.preparedKeys.includes("zh:zf_001") ? { previewAudio: "/managed/samples/zh/zf_001.mp3", previewDuration: 3 } : {}),
                    },
                    ...(state.includePendingVoices ? ["zf_002", "zf_003"].map((id) => ({
                      id, group: "中文 · 女声", label: "", ready: true,
                      ...(state.preparedKeys.includes(`zh:${id}`) ? { previewAudio: `/managed/samples/zh/${id}.mp3`, previewDuration: 3 } : {}),
                    })) : []),
                  ],
                },
                {
                  id: "en",
                  name: "英文配音",
                  desc: "",
                  installed: true,
                  sizeMB: 400,
                  voices: [
                    {
                      id: "af_heart",
                      group: "美式英语 · 女声",
                      label: "",
                      ready: true,
                      ...(state.preparedKeys.includes("en:af_heart") ? { previewAudio: "/managed/samples/en/af_heart.mp3", previewDuration: 3 } : {}),
                    },
                  ],
                },
              ],
            };
          case "list_library":
            return [...voices];
          case "list_history":
            return [...history];
          case "list_previews":
            return [...previews];
          case "default_output_dir":
            return "/exports";
          case "prepare_studio": {
            let sequence = 0;
            const progress = (data: Record<string, unknown>) => emit({ jobId: args.jobId, sequence: ++sequence, ...data });
            emit({ type: "progress", jobId: "obsolete-preparation", sequence: 99, stage: "samples", voiceKey: "zh:zf_003", done: 99, total: 100 });
            progress({ type: "progress", stage: "environment", done: 0, total: 0 });
            if (state.prepareMode === "error") throw "网络连接失败，请继续准备";
            progress({ type: "progress", stage: "samples", voiceKey: "zh:zf_002", done: 2, total: 4 });
            const finish = () => {
              for (const key of ["zh:zf_001", "zh:zf_002", "zh:zf_003", "en:af_heart"]) {
                if (!state.preparedKeys.includes(key)) state.preparedKeys.push(key);
                progress({ type: "sample-ready", voiceKey: key,
                  previewAudio: `/managed/samples/${key.replace(":", "/")}.mp3`, previewDuration: 3 });
              }
              progress({ type: "progress", stage: "samples", done: 4, total: 4 });
              state.pending = null;
            };
            if (state.prepareMode === "slow") {
              return await new Promise<void>((resolve, reject) => {
                state.pending = reject;
                state.completePrepare = () => { finish(); resolve(); };
              });
            }
            finish();
            return;
          }
          case "plugin:dialog|open":
            return args.options?.directory
              ? "/exports"
              : "/samples/reference.wav";
          case "prepare_reference":
            return {
              id: args.jobId,
              path: "/managed/reference.wav",
              duration: args.req.duration,
              peaks: Array(96).fill(0.5),
              warnings: [],
              authorizedAt: Date.now(),
            };
          case "transcribe_reference": {
            emit({ type: "progress", jobId: "obsolete-transcription", sequence: 99,
              stage: "transcription-resources", done: 99, total: 100 });
            emit({ type: "progress", jobId: args.jobId, sequence: 1,
              stage: "transcription", done: 0, total: 0 });
            if (state.transcriptionMode === "error") throw "没有识别到清晰的人声";
            if (state.transcriptionMode === "slow") {
              return await new Promise((_resolve, reject) => { state.pending = reject; });
            }
            return { referenceId: args.id, text: state.transcriptionText };
          }
          case "discard_reference":
            return;
          case "save_voice": {
            const voice = {
              id: "saved-voice-1",
              name: args.req.name,
              model: "clone",
              language: "auto",
              reference: "/managed/voice/reference.wav",
              refText: args.req.refText,
              duration: 10,
              createdAt: Date.now(),
              authorizedAt: Date.now(),
              previewAudio: args.req.previewId ? "/managed/voice/preview.mp3" : null,
              references: [],
            };
            voices.push(voice);
            return voice;
          }
          case "add_voice_reference": {
            const voice = voices.find((item) => item.id === args.id);
            if (!voice || !args.authorized) throw "声音或授权无效";
            voice.references.push({ reference: "/managed/voice/english.wav", refText: args.refText, duration: 20 });
            return { ...voice };
          }
          case "generate_workspace": {
            emit({
              type: "progress",
              jobId: "obsolete-job",
              sequence: 99,
              stage: "synth",
              done: 99,
              total: 100,
            });
            emit({
              type: "progress",
              jobId: args.jobId,
              sequence: 1,
              stage: "load",
              done: 0,
              total: 0,
            });
            emit({
              type: "progress",
              jobId: args.jobId,
              sequence: 0,
              stage: "synth",
              done: 99,
              total: 100,
            });
            if (state.mode === "error") throw "模型返回异常（测试夹具）";
            if (state.mode === "slow")
              return await new Promise((_resolve, reject) => {
                state.pending = reject;
              });
            const request = args.req;
            const bundle = {
              id: args.jobId,
              title: request.title || "未命名配音",
              text: request.text,
              model: request.model,
              voice: request.voice,
              voiceName: request.voiceName,
              speed: request.speed,
              createdAt: Date.now(),
              duration: 3,
              sampleRate: 24000,
              mp3: "/managed/audio.mp3",
              wav: "/managed/audio.wav",
              srt: "/managed/audio.srt",
              txt: "/managed/audio.txt",
              captions: [{ start: 0, end: 2.5, text: request.text }],
              captionRevision: 0,
              preview: request.preview,
            };
            (request.preview ? previews : history).unshift(bundle);
            return bundle;
          }
          case "cancel_job":
            state.pending?.("已取消");
            state.pending = null;
            state.mode = "success";
            return;
          case "save_captions": {
            const bundle = history.find((item) => item.id === args.id);
            bundle.captions = args.captions;
            bundle.captionRevision++;
            return { ...bundle };
          }
          case "export_bundle":
            return `/exports/配音-${Date.now()}`;
          case "delete_record": {
            const index = history.findIndex((item) => item.id === args.id);
            history.splice(index, 1);
            return;
          }
          case "clear_previews":
            previews.length = 0;
            return;
          default:
            if (command.startsWith("plugin:opener|")) return;
            throw `未实现的测试 IPC：${command}`;
        }
      },
    };
  });
}
export async function setMode(page: Page, mode: "success" | "slow" | "error") {
  await page.evaluate((mode) => {
    (
      window as unknown as { __STUDIO_TEST__: { mode: string } }
    ).__STUDIO_TEST__.mode = mode;
  }, mode);
}
