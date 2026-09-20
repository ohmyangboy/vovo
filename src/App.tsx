import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import type { EnvStatus, ModelInfo } from "./types";
import { InstallCard, LogPanel } from "./components/InstallCard";
import { DocumentCard } from "./components/DocumentCard";
import { SettingsCard } from "./components/SettingsCard";
import { GenerateCard } from "./components/GenerateCard";
import { TextInputSheet } from "./components/TextInputSheet";

export default function App() {
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("en");
  const [selectedVoice, setSelectedVoice] = useState("af_heart");
  const [docTitle, setDocTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [speed, setSpeed] = useState(1.0);
  const [outputDir, setOutputDir] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 1 });
  const [status, setStatus] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastMP3, setLastMP3] = useState("");
  const [lastSRT, setLastSRT] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voices = useMemo(
    () => models.find((m) => m.id === selectedModel)?.voices ?? [],
    [models, selectedModel]
  );
  const currentModel = models.find((m) => m.id === selectedModel);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => {
      const next = [...prev, line];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const handleEngineEvent = useCallback((line: string) => {
    try {
      const obj = JSON.parse(line);
      switch (obj.type) {
        case "progress":
          setProgress({ done: obj.done ?? 0, total: obj.total ?? 1 });
          if (obj.label) setStatus(String(obj.label));
          break;
        case "log":
          if (obj.message) setStatus(String(obj.message));
          break;
        case "done":
          if (obj.mp3) setLastMP3(String(obj.mp3));
          if (obj.srt) setLastSRT(String(obj.srt));
          if (typeof obj.duration === "number") {
            setStatus(`完成 ✓ 时长 ${(obj.duration / 60).toFixed(1)} 分钟`);
          }
          break;
        case "error":
          setStatus("出错：" + String(obj.message ?? ""));
          break;
        default:
          break;
      }
    } catch {
      /* 非 JSON 行忽略 */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const envStatus = await api.checkEnv();
      setEnv(envStatus);
      if (envStatus.ready) {
        const payload = await api.listVoices();
        setModels(payload.models ?? []);
      } else {
        setModels([]);
      }
    } catch {
      setEnv({ installed: false, ready: false });
    }
  }, []);

  const importDoc = useCallback(async (path: string) => {
    try {
      const doc = await api.importDoc(path);
      setDocTitle(doc.title);
      setParagraphs(doc.paragraphs);
      setLastMP3("");
      setLastSRT("");
      setStatus(`已导入 ${doc.count} 个段落`);
    } catch (e) {
      setStatus("导入失败：" + String(e));
    }
  }, []);

  // 初始化
  useEffect(() => {
    (async () => {
      try {
        const p = await api.platformInfo();
        document.body.classList.add(`platform-${p.os}`);
      } catch {
        /* 浏览器预览模式 */
      }
      try {
        setOutputDir(await api.defaultOutputDir());
      } catch {
        /* ignore */
      }
      await refresh();
    })();
  }, [refresh]);

  // 引擎事件 + 拖拽
  useEffect(() => {
    const disposers: Array<() => void> = [];
    let cancelled = false;
    (async () => {
      try {
        const d1 = await listen<string>("engine-log", (e) => appendLog(e.payload));
        const d2 = await listen<string>("engine-event", (e) => handleEngineEvent(e.payload));
        const d3 = await listen<string>("engine-event-log", (e) => appendLog(e.payload));
        if (cancelled) {
          d1();
          d2();
          d3();
          return;
        }
        disposers.push(d1, d2, d3);
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === "over") {
            setDragging(true);
          } else if (event.payload.type === "drop") {
            setDragging(false);
            const path = event.payload.paths?.[0];
            if (path && /\.(txt|md|markdown|docx)$/i.test(path)) {
              void importDoc(path);
            }
          } else {
            setDragging(false);
          }
        });
        if (cancelled) un();
        else disposers.push(un);
      } catch {
        /* 非 Tauri 环境 */
      }
    })();
    return () => {
      cancelled = true;
      disposers.forEach((d) => d());
    };
  }, [appendLog, handleEngineEvent, importDoc]);

  async function install() {
    setInstalling(true);
    setShowLog(true);
    setLog([]);
    try {
      await api.installEngine();
    } catch (e) {
      appendLog("❌ " + String(e));
    }
    setInstalling(false);
    await refresh();
  }

  async function downloadModel(id: string) {
    setBusy(true);
    setShowLog(true);
    try {
      await api.downloadModel(id);
    } catch (e) {
      appendLog("❌ " + String(e));
    }
    setBusy(false);
    await refresh();
  }

  async function deleteModel(id: string) {
    setBusy(true);
    try {
      await api.deleteModel(id);
    } catch (e) {
      appendLog("❌ " + String(e));
    }
    setBusy(false);
    await refresh();
  }

  async function pickFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "文稿", extensions: ["txt", "md", "markdown", "docx"] }],
    });
    if (typeof selected === "string") {
      await importDoc(selected);
    }
  }

  async function pickOutputDir() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setOutputDir(selected);
    }
  }

  function applyTextDraft() {
    const paras = textDraft
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!paras.length) return;
    setDocTitle("手动输入");
    setParagraphs(paras);
    setLastMP3("");
    setLastSRT("");
    setStatus(`已输入 ${paras.length} 个段落`);
    setShowTextInput(false);
  }

  async function preview() {
    if (previewing) return;
    setPreviewing(true);
    try {
      const path = await api.previewVoice(selectedModel, selectedVoice);
      const bytes = await api.readAudio(path);
      const blob = new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" });
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audioRef.current = audio;
      await audio.play();
    } catch (e) {
      setStatus("试听失败：" + String(e));
    }
    setPreviewing(false);
  }

  async function generate() {
    if (!paragraphs.length || generating) return;
    if (currentModel && !currentModel.installed) {
      setStatus(`请先在「模型管理」中下载「${currentModel.name}」`);
      return;
    }
    setGenerating(true);
    setProgress({ done: 0, total: 1 });
    setStatus("准备中 ...");
    setLastMP3("");
    setLastSRT("");
    try {
      await api.generate({
        model: selectedModel,
        voice: selectedVoice,
        speed,
        paragraphs,
        outdir: outputDir,
        name: sanitize(docTitle || "配音"),
      });
    } catch (e) {
      setStatus("生成失败：" + String(e));
    }
    setGenerating(false);
  }

  function onModelChange(id: string) {
    setSelectedModel(id);
    const first = models.find((m) => m.id === id)?.voices[0];
    if (first) setSelectedVoice(first.id);
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">🎙</div>
          <div>
            <h1>配音工坊</h1>
            <p>本地模型 · 文稿转配音 + 字幕</p>
          </div>
        </div>
        {env?.ready && (
          <button className="btn ghost small" onClick={() => void refresh()}>
            刷新
          </button>
        )}
      </header>

      <main className="app-body">
        {env && !env.ready && (
          <InstallCard
            installing={installing}
            installed={env.installed}
            onInstall={() => void install()}
          />
        )}

        {(installing || showLog) && log.length > 0 && (
          <LogPanel log={log} onHide={() => setShowLog(false)} />
        )}

        <DocumentCard
          docTitle={docTitle}
          paragraphs={paragraphs}
          dragging={dragging}
          disabled={!env?.ready}
          onPickFile={() => void pickFile()}
          onOpenTextInput={() => setShowTextInput(true)}
          onClear={() => {
            setDocTitle("");
            setParagraphs([]);
            setLastMP3("");
            setLastSRT("");
            setStatus("");
          }}
        />

        <SettingsCard
          models={models}
          selectedModel={selectedModel}
          selectedVoice={selectedVoice}
          voices={voices}
          speed={speed}
          outputDir={outputDir}
          previewing={previewing}
          busy={busy || installing}
          disabled={!env?.ready}
          onModelChange={onModelChange}
          onVoiceChange={setSelectedVoice}
          onSpeedChange={setSpeed}
          onPreview={() => void preview()}
          onPickOutput={() => void pickOutputDir()}
          onDownload={(id) => void downloadModel(id)}
          onDelete={(id) => void deleteModel(id)}
        />

        <GenerateCard
          generating={generating}
          progress={progress}
          status={status}
          canGenerate={!!env?.ready && paragraphs.length > 0}
          onGenerate={() => void generate()}
          lastMP3={lastMP3}
          lastSRT={lastSRT}
          onReveal={() => {
            if (lastMP3) void revealItemInDir(lastMP3);
          }}
          onOpenSRT={() => {
            if (lastSRT) void revealItemInDir(lastSRT);
          }}
        />
      </main>

      {showTextInput && (
        <TextInputSheet
          draft={textDraft}
          setDraft={setTextDraft}
          onApply={applyTextDraft}
          onClose={() => setShowTextInput(false)}
        />
      )}
    </div>
  );
}

function sanitize(name: string) {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim() || "配音";
}
