import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, desktop } from "./api";
import { initialModels, modelNames, voiceChoices } from "./catalog";
import {
  characterCount,
  estimatedDuration,
  draftStorageKey,
  preferencesStorageKey,
  importText,
  readDraft,
  readPreferences,
} from "./domain";
import type {
  Bundle,
  Caption,
  CloneStatus,
  Draft,
  EnvStatus,
  ExportFormat,
  ModelId,
  ModelInfo,
  Page,
  PreviewPlayback,
  Preferences,
  SavedVoice,
  VoiceChoice,
} from "./types";
import { useJobs } from "./hooks/useJobs";
import { Icon } from "./components/Icon";
import { Modal } from "./components/Modal";
import { Workspace } from "./components/Workspace";
import { VoiceBrowser } from "./components/VoiceBrowser";
import { CloneWizard } from "./components/CloneWizard";
import { ResultPanel } from "./components/ResultPanel";
import { HistoryPage } from "./components/HistoryPage";
import { SidebarHistory } from "./components/SidebarHistory";
import { AppTitlebar } from "./components/AppTitlebar";
import { SettingsPage, type ResourceAction } from "./components/SettingsPage";
import { ExportDialog } from "./components/ExportDialog";

type Toast = {
  message: string;
  tone: "error" | "success" | "info";
  path?: string;
};
type Confirmation = {
  title: string;
  message: string;
  danger: boolean;
  resolve: (confirmed: boolean) => void;
};

export default function App() {
  const [page, setPage] = useState<Page>("workspace");
  const [draft, setDraft] = useState<Draft>(readDraft);
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [saved, setSaved] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>(initialModels);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [clone, setClone] = useState<CloneStatus | null>(null);
  const [library, setLibrary] = useState<SavedVoice[]>([]);
  const [records, setRecords] = useState<Bundle[]>([]);
  const [result, setResult] = useState<Bundle>();
  const [historyId, setHistoryId] = useState<string>();
  const [picker, setPicker] = useState<{ model?: ModelId }>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<SavedVoice>();
  const [exporting, setExporting] = useState<Bundle>();
  const [setup, setSetup] = useState<{ model: ModelId; voice: string }>();
  const [resourceTarget, setResourceTarget] = useState<string>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [renaming, setRenaming] = useState<VoiceChoice>();
  const [rename, setRename] = useState("");
  const [toast, setToast] = useState<Toast>();
  const [playback, setPlayback] = useState<PreviewPlayback>();
  const [previewing, setPreviewing] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [startupLogs, setStartupLogs] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewCache = useRef(new Map<string, Bundle>());
  const previewEpoch = useRef(0);
  const previewOrigin = useRef<PreviewPlayback["origin"] | undefined>(undefined);
  useEffect(() => {
    previewEpoch.current += 1;
    setPlayback(undefined);
  }, [page]);
  const refreshVersion = useRef(0);
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "info") =>
      setToast({ message, tone }),
    [],
  );
  const jobs = useJobs(notify, (event) => {
    if (event.type !== "sample-ready" || !event.voiceKey || !event.previewAudio) return;
    if (event.voiceKey.startsWith("clone:")) {
      setLibrary((previous) => previous.map((item) => `clone:${item.id}` === event.voiceKey
        ? { ...item, previewAudio: event.previewAudio! } : item));
      return;
    }
    setModels((previous) => previous.map((model) => ({
      ...model,
      voices: model.voices.map((item) => `${model.id}:${item.id}` === event.voiceKey
        ? { ...item, ready: true, previewAudio: event.previewAudio, previewDuration: event.previewDuration }
        : item),
    })));
  });
  const busy = !!jobs.active;
  const voices = useMemo(
    () => voiceChoices(models, library),
    [models, library],
  );
  const voice = voices.find((v) => v.key === draft.voiceKey);
  const historySelection = records.find((record) => record.id === historyId);

  const updateDraft = useCallback((patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((previous) => ({ ...previous, ...patch }));
  }, []);
  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) =>
      setPreferences((previous) => ({ ...previous, ...patch })),
    [],
  );
  const refresh = useCallback(async () => {
    if (!desktop) return;
    const version = ++refreshVersion.current;
    const results = await Promise.allSettled([
      api.checkEnv(),
      api.listVoices(),
      api.cloneStatus(),
      api.listLibrary(),
      api.listHistory(),
      api.listPreviews(),
    ]);
    if (version !== refreshVersion.current) return;
    const [environment, catalog, status, savedVoices, history, previews] =
      results;
    if (environment.status === "fulfilled") setEnv(environment.value);
    else
      setEnv({
        installed: false,
        ready: false,
        raw: String(environment.reason),
      });
    if (catalog.status === "fulfilled") setModels(catalog.value.models);
    if (status.status === "fulfilled") setClone(status.value);
    if (savedVoices.status === "fulfilled") setLibrary(savedVoices.value);
    if (history.status === "fulfilled") setRecords(history.value);
    if (previews.status === "fulfilled") {
      previewCache.current.clear();
      for (const bundle of [...previews.value].reverse())
        previewCache.current.set(
          JSON.stringify([
            `${bundle.model}:${bundle.voice}`,
            bundle.text,
            bundle.speed,
          ]),
          bundle,
        );
    }
    setStartupLogs(
      results.flatMap((result) =>
        result.status === "rejected" ? [String(result.reason)] : [],
      ),
    );
    if (savedVoices.status === "rejected" || history.status === "rejected")
      notify("本地声音或记录读取失败，请查看设置中的诊断详情", "error");
  }, [notify]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void api
      .platformInfo()
      .then((platform) => {
        if (!disposed) document.body.dataset.platform = platform.os;
      })
      .catch(() => {});
    void api
      .defaultOutputDir()
      .then((directory) => {
        if (!disposed)
          setPreferences((previous) =>
            previous.outputDir
              ? previous
              : { ...previous, outputDir: directory },
          );
      })
      .catch(() => {});
    void refresh();
    return () => {
      disposed = true;
      refreshVersion.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(draft));
        localStorage.setItem(
          preferencesStorageKey,
          JSON.stringify(preferences),
        );
        setSaved(true);
      } catch {
        setSaved(false);
        notify("自动保存失败，可能是本地存储已满；请先保留文稿副本", "error");
      }
    }, 400);
    const flush = () => {
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(draft));
        localStorage.setItem(
          preferencesStorageKey,
          JSON.stringify(preferences),
        );
      } catch {
        /* 已通过自动保存反馈错误。 */
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeunload", flush);
    };
  }, [draft, preferences, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(undefined),
      toast.tone === "error" ? 10000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [toast]);

  function confirm(
    title: string,
    message: string,
    danger = false,
  ): Promise<boolean> {
    return new Promise((resolve) =>
      setConfirmation({ title, message, danger, resolve }),
    );
  }
  function closeConfirmation(confirmed: boolean) {
    confirmation?.resolve(confirmed);
    setConfirmation(undefined);
  }
  function dismissPreview() {
    previewEpoch.current += 1;
    setPlayback(undefined);
  }
  function closePicker() {
    dismissPreview();
    setPicker(undefined);
    if (jobs.active?.kind === "preview" && previewOrigin.current === "voice") void jobs.cancel();
  }
  function openPicker() {
    dismissPreview();
    if (jobs.active?.kind === "preview") void jobs.cancel();
    setPicker({});
  }
  function chooseVoice(choice: VoiceChoice) {
    setPreferences((previous) => ({
      ...previous,
      recent: [
        choice.key,
        ...previous.recent.filter((key) => key !== choice.key),
      ].slice(0, 12),
    }));
    updateDraft({
      voiceKey: choice.key,
    });
    closePicker();
    setPage("workspace");
  }
  function toggleFavorite(key: string) {
    setPreferences((previous) => ({
      ...previous,
      favorites: previous.favorites.includes(key)
        ? previous.favorites.filter((v) => v !== key)
        : [...previous.favorites, key],
    }));
  }
  function canGenerate(choice: VoiceChoice): boolean {
    if (!desktop) {
      notify("当前是网页预览，请使用桌面应用生成语音", "info");
      return false;
    }
    if (choice.model === "clone") {
      if (!clone?.supported) {
        notify("本地声音克隆目前需要 Apple Silicon Mac", "info");
        return false;
      }
      if (clone.engine !== "0.5.8" || !clone.installed || !clone.ffmpeg) {
        setSetup({ model: "clone", voice: choice.name });
        return false;
      }
    } else if (!env?.ready || !choice.ready) {
      setSetup({ model: choice.model, voice: choice.name });
      return false;
    }
    return true;
  }
  function openClone() {
    closePicker();
    if (!desktop) {
      notify("声音克隆需要桌面应用，网页仅支持界面预览", "info");
      return;
    }
    if (!clone?.supported) {
      notify("本地声音克隆目前仅支持 Apple Silicon Mac", "info");
      return;
    }
    if (!clone.ffmpeg || !clone.installed || clone.engine !== "0.5.8") {
      setSetup({ model: "clone", voice: "我的声音" });
      return;
    }
    setEditingVoice(undefined);
    setCloneOpen(true);
  }
  function supplementVoice(choice: VoiceChoice) {
    const savedVoice = library.find((item) => item.id === choice.id);
    if (!savedVoice) return;
    if ((savedVoice.references?.length ?? 0) >= 2) {
      notify("这个声音已保留 3 段录音，可以先试听效果", "info");
      return;
    }
    closePicker();
    if (!canGenerate(choice)) return;
    openClone();
    setEditingVoice(savedVoice);
  }
  function goSettings(model?: string) {
    setResourceTarget(model);
    setSetup(undefined);
    setCloneOpen(false);
    closePicker();
    setPage("settings");
  }
  async function reveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (error) {
      notify(`无法打开文件夹：${String(error)}`, "error");
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制到剪贴板", "success");
    } catch {
      notify("无法访问剪贴板，请手动选择文字复制", "error");
    }
  }
  async function pickDirectory(): Promise<string | undefined> {
    if (!desktop) {
      notify("选择本地目录需要桌面应用", "info");
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: preferences.outputDir || undefined,
      });
      if (typeof selected === "string") return selected;
    } catch (error) {
      notify(String(error), "error");
    }
  }
  async function exportFiles(
    bundle: Bundle,
    directory: string,
    formats: ExportFormat[],
    automatic = false,
  ) {
    updatePreferences({ outputDir: directory, formats });
    const path = await jobs.run("export", "导出文件", () =>
      api.exportBundle(bundle.id, directory, formats),
    );
    if (path) {
      if (!automatic) setExporting(undefined);
      setToast({
        message: automatic
          ? "配音与字幕已自动导出"
          : "文件已导出，旧文件不会被覆盖",
        tone: "success",
        path,
      });
    } else if (!automatic) {
      setExporting(bundle);
    }
  }
  async function generate() {
    if (!voice || busy || !draft.text.trim()) return;
    if (!canGenerate(voice)) return;
    previewEpoch.current += 1;
    setPlayback(undefined);
    const bundle = await jobs.run("generate", "准备生成配音", (id) =>
      api.generateWorkspace(id, {
        model: voice.model,
        voice: voice.id,
        voiceName: voice.name,
        title: draft.title,
        text: draft.text,
        speed: draft.speed,
        preview: false,
      }),
    );
    if (!bundle) return;
    setPreferences((previous) => ({
      ...previous,
      recent: [
        voice.key,
        ...previous.recent.filter((key) => key !== voice.key),
      ].slice(0, 12),
    }));
    setResult(bundle);
    setRecords((previous) => [
      bundle,
      ...previous.filter((record) => record.id !== bundle.id),
    ]);
    notify("配音与字幕已生成，先听一听，再导出", "success");
    if (preferences.autoExport) {
      if (preferences.outputDir)
        await exportFiles(
          bundle,
          preferences.outputDir,
          preferences.formats,
          true,
        );
      else
        notify("配音已保留在生成记录中，请先在设置中选择自动导出位置", "info");
    }
  }
  async function previewText(choice: VoiceChoice, text: string, speed = 1, origin: PreviewPlayback["origin"] = "workspace") {
    if (!text.trim()) return;
    const limit = /[A-Za-z]/.test(text) && !/[\u3400-\u9fff]/.test(text) ? 320 : 90;
    let sample = Array.from(text.trim()).slice(0, limit).join("");
    if (sample.length < text.trim().length) {
      const end = Math.max(sample.lastIndexOf("."), sample.lastIndexOf("!"), sample.lastIndexOf("?"), sample.lastIndexOf("。"), sample.lastIndexOf("！"), sample.lastIndexOf("？"));
      if (end >= sample.length / 3) sample = sample.slice(0, end + 1);
      else if (limit === 320 && sample.lastIndexOf(" ") > 0) sample = sample.slice(0, sample.lastIndexOf(" "));
    }
    const cacheKey = JSON.stringify([choice.key, sample, speed,
      ...(choice.kind === "cloned" ? [library.find((item) => item.id === choice.id)?.references ?? []] : [])]);
    const cached = previewCache.current.get(cacheKey);
    if (cached) {
      previewEpoch.current += 1;
      setPlayback({
        path: cached.wav,
        name: choice.name,
        duration: cached.duration,
        startedAt: Date.now(),
        origin,
        voiceKey: choice.key,
      });
      return;
    }
    if (busy) return;
    if (!canGenerate(choice)) return;
    const epoch = ++previewEpoch.current;
    setPlayback(undefined);
    setPreviewing(choice.key);
    previewOrigin.current = origin;
    try {
      const bundle = await jobs.run("preview", "准备短句试听", (id) =>
        api.generateWorkspace(id, {
          model: choice.model,
          voice: choice.id,
          voiceName: choice.name,
          title: "短句试听",
          text: sample,
          speed,
          preview: true,
        }),
      );
      if (bundle) {
        previewCache.current.set(cacheKey, bundle);
        if (epoch === previewEpoch.current) setPlayback({
          path: bundle.wav,
          name: choice.name,
          duration: bundle.duration,
          startedAt: Date.now(),
          origin,
          voiceKey: choice.key,
        });
        if (characterCount(text) > characterCount(sample))
          notify("本次试听文稿开头，完整配音请点击生成", "info");
      }
    } finally {
      previewOrigin.current = undefined;
      setPreviewing(undefined);
    }
  }
  async function previewVoice(choice: VoiceChoice) {
    if (choice.previewAudio) {
      previewEpoch.current += 1;
      setPlayback({ path: choice.previewAudio, name: choice.name, duration: choice.previewDuration, startedAt: Date.now(), origin: "voice", voiceKey: choice.key });
      return;
    }
    if (choice.kind === "preset") {
      goSettings(choice.model);
      return;
    }
    await previewText(
      choice,
      choice.language === "en"
        ? "Hello. A familiar voice can bring every story to life."
        : "你好，让每一段文字，都拥有自己的声音。",
      1,
      "voice",
    );
  }
  async function applyImported(title: string, text: string) {
    if (!text.trim()) {
      notify("这份文稿没有可用的文字", "info");
      return;
    }
    if (
      draft.text.trim() &&
      !(await confirm(
        "替换当前文稿？",
        "导入会替换工作台里的文字，已经生成的记录不受影响。",
      ))
    )
      return;
    updateDraft({ title, text });
    setPage("workspace");
    notify("文稿已导入，可以直接编辑", "success");
  }
  async function importPath(path: string) {
    try {
      const doc = await api.importDoc(path);
      await applyImported(
        doc.title,
        importText(
          doc.paragraphs.join("\n\n"),
          doc.type === "md" || doc.type === "markdown",
        ),
      );
    } catch (error) {
      notify(`导入失败：${String(error)}`, "error");
    }
  }
  async function importBrowserFile(file: File) {
    if (desktop) return;
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      notify("网页预览支持 TXT/MD；DOCX 请在桌面应用中导入", "info");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify("文稿文件过大，请分段导入", "error");
      return;
    }
    try {
      await applyImported(
        file.name.replace(/\.[^.]+$/, ""),
        importText(await file.text(), /\.(md|markdown)$/i.test(file.name)),
      );
    } catch (error) {
      notify(String(error), "error");
    }
  }
  async function pickFile() {
    if (!desktop) {
      fileInput.current?.click();
      return;
    }
    try {
      const file = await open({
        multiple: false,
        filters: [
          { name: "文稿", extensions: ["txt", "md", "markdown", "docx"] },
        ],
      });
      if (typeof file === "string") await importPath(file);
    } catch (error) {
      notify(String(error), "error");
    }
  }
  const dropHandler = useRef(importPath);
  dropHandler.current = importPath;
  const acceptsDrop = useRef(false);
  acceptsDrop.current =
    page === "workspace" &&
    !picker &&
    !cloneOpen &&
    !exporting &&
    !confirmation;
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!acceptsDrop.current) return;
        if (event.payload.type === "over") setDragging(true);
        else if (event.payload.type === "drop") {
          setDragging(false);
          const path = event.payload.paths[0];
          if (path && /\.(txt|md|markdown|docx)$/i.test(path))
            void dropHandler.current(path);
          else notify("请拖入 TXT、Markdown 或 DOCX 文稿", "info");
        } else setDragging(false);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notify]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        picker ||
        cloneOpen ||
        exporting ||
        setup ||
        confirmation ||
        renaming
      )
        return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void pickFile();
      }
      if (
        event.key === "Enter" &&
        page === "workspace" &&
        !(
          event.target instanceof Element &&
          event.target.closest(".result-panel")
        )
      ) {
        event.preventDefault();
        void generate();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  async function clearPreviews() {
    if (
      !(await confirm(
        "清理试听缓存？",
        "会删除临时文稿试听。声音库已准备好的试听、我的声音、正式配音和已导出的文件都会保留。",
        true,
      ))
    )
      return;
    const done = await jobs.run("remove", "清理试听缓存", async () => {
      await api.clearPreviews();
      return true;
    });
    if (done) {
      previewCache.current.clear();
      setPlayback(undefined);
      notify("试听缓存已清理", "success");
    }
  }
  async function resourceAction(action: ResourceAction) {
    if (
      action.startsWith("delete") &&
      !(await confirm(
        "移除配音资源？",
        "已生成的配音、字幕和保存的声音资料会保留。之后使用这些声音时，需要再次一键准备。",
        true,
      ))
    )
      return;
    const kind = action === "prepare"
      ? "prepare"
      : action.startsWith("download")
      ? "download"
      : action.startsWith("delete")
        ? "remove"
        : "install";
    const completed = await jobs.run(
      kind,
      kind === "prepare"
        ? "正在准备配音功能…"
        : kind === "download"
        ? "下载本地资源…"
        : kind === "remove"
          ? "移除本地资源…"
          : "准备运行环境…",
      async (id) => {
        switch (action) {
          case "prepare":
            await api.prepareStudio(id);
            break;
          case "install":
            await api.installEngine(id);
            break;
          case "download-zh":
            await api.downloadModel("zh", id);
            break;
          case "download-en":
            await api.downloadModel("en", id);
            break;
          case "delete-zh":
            await api.deleteModel("zh");
            break;
          case "delete-en":
            await api.deleteModel("en");
            break;
          case "install-clone":
            await api.setupClone(id);
            break;
          case "download-clone":
            await api.downloadClone(id);
            break;
          case "delete-clone":
            await api.deleteClone();
            break;
        }
        return true;
      },
    );
    await refresh();
    if (completed)
      notify(
        kind === "remove"
          ? "模型资源已移除，生成记录仍保留"
          : kind === "prepare"
            ? "全部准备完成，声音库可直接试听，也可以开始配音了"
            : "操作完成，资源状态已更新",
        "success",
      );
  }
  async function removeVoice(choice: VoiceChoice) {
    if (
      !(await confirm(
        `删除「${choice.name}」？`,
        "会删除该声音的本地参考录音与文字，但已经生成的音频和字幕不受影响。",
        true,
      ))
    )
      return;
    const done = await jobs.run("remove", "删除声音", async () => {
      await api.deleteVoice(choice.id);
      return true;
    });
    if (done) {
      setLibrary((previous) =>
        previous.filter((item) => item.id !== choice.id),
      );
      setPreferences((previous) => ({
        ...previous,
        favorites: previous.favorites.filter((key) => key !== choice.key),
      }));
      if (draft.voiceKey === choice.key) updateDraft({ voiceKey: "" });
      notify("声音已删除，生成记录仍保留", "success");
    }
  }
  async function renameVoice() {
    if (!renaming || !rename.trim()) return;
    const updated = await jobs.run("save", "保存声音名称", () =>
      api.renameVoice(renaming.id, rename.trim()),
    );
    if (updated) {
      setLibrary((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      setRenaming(undefined);
      notify("声音名称已更新", "success");
    }
  }
  async function removeRecord(bundle: Bundle) {
    if (
      !(await confirm(
        "删除这份生成记录？",
        "会删除应用内保存的音频、字幕和文稿。已经导出的文件不会删除。",
        true,
      ))
    )
      return;
    const done = await jobs.run("remove", "删除生成记录", async () => {
      await api.deleteRecord(bundle.id);
      return true;
    });
    if (done) {
      setRecords((previous) =>
        previous.filter((item) => item.id !== bundle.id),
      );
      const next = records.find((item) => item.id !== bundle.id);
      setHistoryId((current) => current === bundle.id ? next?.id : current);
      if (!next) setPage((current) => current === "history" ? "workspace" : current);
      if (result?.id === bundle.id) setResult(undefined);
      notify("生成记录已删除", "success");
    }
  }
  async function useRecord(bundle: Bundle) {
    if (
      draft.text.trim() &&
      draft.text.trim() !== bundle.text &&
      !(await confirm(
        "使用这份文稿？",
        "会替换工作台的文稿与声音选择，已有生成记录不受影响。",
      ))
    )
      return;
    updateDraft({
      title: bundle.title,
      text: bundle.text,
      voiceKey: `${bundle.model}:${bundle.voice}`,
      speed: bundle.speed,
    });
    setResult(bundle);
    setPage("workspace");
    if (
      !voices.some((choice) => choice.key === `${bundle.model}:${bundle.voice}`)
    )
      notify("原声音已经移除，请重新选择声音后生成", "info");
  }
  async function saveCaptions(bundle: Bundle, captions: Caption[]) {
    const updated = await jobs.run("save", "保存字幕", () =>
      api.saveCaptions(bundle.id, captions),
    );
    if (updated) {
      setRecords((previous) =>
        previous.map((record) => (record.id === updated.id ? updated : record)),
      );
      if (result?.id === updated.id) setResult(updated);
      notify("字幕已保存，配音内容没有改变", "success");
    }
  }
  function renderResult(bundle?: Bundle, outdated = false, onPreview?: () => void) {
    const count = characterCount(draft.text);
    const limit = voice?.model === "clone" ? 2000 : 10000;
    return (
      <ResultPanel
        key={bundle?.id ?? "draft"}
        bundle={bundle}
        outdated={outdated}
        busy={busy}
        onExport={(item) => preferences.outputDir
          ? void exportFiles(item, preferences.outputDir, preferences.formats)
          : setExporting(item)}
        onExportOptions={setExporting}
        onSaveCaptions={saveCaptions}
        onCopy={(text) => void copy(text)}
        onReveal={(path) => void reveal(path)}
        summary={onPreview ? { count, limit, estimate: estimatedDuration(draft.text, draft.speed), saved } : undefined}
        preview={onPreview && playback?.origin === "workspace" ? playback : undefined}
        onDismissPreview={dismissPreview}
        onPreview={onPreview}
        onGenerate={onPreview ? () => void generate() : undefined}
        canGenerate={!!voice && !!draft.text.trim() && count <= limit}
        job={jobs.active}
        onCancel={() => void jobs.cancel()}
      />
    );
  }
  const outdated =
    !!result &&
    (result.text !== draft.text.trim() ||
      `${result.model}:${result.voice}` !== draft.voiceKey ||
      result.speed !== draft.speed);

  return (
    <div className="app-shell">
      <AppTitlebar page={page} onSettings={() => goSettings()} />
      <aside className="sidebar">
        <nav aria-label="主导航">
          <button className={`nav-item${page === "workspace" ? " active" : ""}`}
            aria-current={page === "workspace" ? "page" : undefined}
            onClick={() => setPage("workspace")}>
            <Icon name="edit" size={19} /><span>生成工作台</span>
          </button>
        </nav>
        <SidebarHistory records={records} selected={page === "history" ? historyId : undefined}
          onOpen={(record) => { dismissPreview(); setHistoryId(record.id); setPage("history"); }} />
        <div className="sidebar-bottom">
          {jobs.active && (
            <button
              className="sidebar-task"
              onClick={() =>
                setPage(
                  ["generate", "preview"].includes(jobs.active?.kind ?? "") ? "workspace" : "settings",
                )
              }
            >
              <span className="spinner" />
              <span>
                {jobs.active.cancelling ? "正在取消…" : jobs.active.label}
              </span>
            </button>
          )}
        </div>
      </aside>
      <main className={`main-content${page === "settings" ? " settings-content" : " studio-content"}`} key={page}>
        {page === "workspace" && (
          <Workspace
            draft={draft}
            onDraft={updateDraft}
            voice={voice}
            onChooseVoice={openPicker}
            onImport={() => void pickFile()}
            onBrowserFile={(file) => void importBrowserFile(file)}
            onClear={() =>
              void confirm(
                "清空当前文稿？",
                "已经生成的配音和字幕仍保留在生成记录中。",
              ).then((confirmed) => {
                if (confirmed) updateDraft({ title: "", text: "" });
              })
            }
            onPreview={(text) => {
              if (voice)
                void previewText(
                  voice,
                  text,
                  draft.speed,
                );
            }}
            job={jobs.active}
            dragging={dragging}
            saved={saved}
            renderFooter={(onPreview) => renderResult(result, outdated, onPreview)}
          />
        )}
        {page === "history" && historySelection && (
          <HistoryPage
            selected={historySelection}
            busy={busy}
            onUse={(record) => void useRecord(record)}
            onDelete={(record) => void removeRecord(record)}
            renderResult={renderResult}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            env={env}
            clone={clone}
            models={models}
            voices={voices}
            preferences={preferences}
            onPreferences={updatePreferences}
            onDirectory={() =>
              void pickDirectory().then((directory) => {
                if (directory) updatePreferences({ outputDir: directory });
              })
            }
            onAction={(action) => void resourceAction(action)}
            onClearPreviews={() => void clearPreviews()}
            onRefresh={() => void refresh()}
            onBack={() => setPage("workspace")}
            job={jobs.active}
            onCancel={() => void jobs.cancel()}
            logs={[...startupLogs, ...jobs.logs]}
            target={resourceTarget}
            onCopy={(text) => void copy(text)}
          />
        )}
      </main>
      <input
        className="visually-hidden"
        type="file"
        ref={fileInput}
        accept=".txt,.md,.markdown"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importBrowserFile(file);
        }}
      />
      {picker && (
        <Modal
          title={
            picker.model
              ? `选择${modelNames[picker.model]}的声音`
              : "选择一个声音"
          }
          wide
          onClose={closePicker}
        >
          <VoiceBrowser
            voices={voices}
            selected={draft.voiceKey}
            favorites={preferences.favorites}
            recent={preferences.recent}
            busy={busy}
            previewing={previewing}
            playback={playback?.origin === "voice" ? playback : undefined}
            onDismissPreview={dismissPreview}
            preparation={jobs.active?.kind === "prepare" ? jobs.active : undefined}
            onPrepare={() => goSettings()}
            initialModel={picker.model}
            onChoose={chooseVoice}
            onPreview={(choice) => void previewVoice(choice)}
            onFavorite={toggleFavorite}
            onClone={openClone}
            onDelete={(choice) => { closePicker(); void removeVoice(choice); }}
            onAddReference={supplementVoice}
            onRename={(choice) => {
              closePicker();
              setRenaming(choice);
              setRename(choice.name);
            }}
          />
        </Modal>
      )}
      {cloneOpen && (
        <CloneWizard
          status={clone}
          job={jobs.active}
          run={jobs.run}
          onCancel={() => void jobs.cancel()}
          onClose={() => setCloneOpen(false)}
          onSaved={(savedVoice) => {
            setLibrary((previous) => [savedVoice, ...previous.filter((item) => item.id !== savedVoice.id)]);
            if (!editingVoice) updateDraft({ voiceKey: `clone:${savedVoice.id}` });
            setCloneOpen(false);
            if (!editingVoice) setPage("workspace");
            notify(editingVoice ? "参考录音已保存，重新生成时会优先使用语言匹配的录音" : "声音已保存，可以直接用于当前文稿", "success");
          }}
          onSettings={() => goSettings("clone")}
          notify={notify}
          existingVoice={editingVoice}
        />
      )}
      {exporting && (
        <ExportDialog
          bundle={exporting}
          preferences={preferences}
          busy={busy}
          onClose={() => setExporting(undefined)}
          onDirectory={pickDirectory}
          onExport={(directory, formats) =>
            exportFiles(exporting, directory, formats)
          }
        />
      )}
      {setup && (
        <Modal
          title="先准备配音功能"
          description="一次准备好配音、声音试听和本机支持的声音克隆。"
          onClose={() => setSetup(undefined)}
        >
          <div className="setup-dialog">
            <span className="voice-avatar">
              <Icon name="wave" size={25} />
            </span>
            <div>
              <strong>{setup.voice}</strong>
              <p>{modelNames[setup.model]}</p>
            </div>
            <p>
              点击一次即可自动完成。已有资源会复用，文稿与当前选择都会保留。
            </p>
          </div>
          <footer className="modal-footer">
            <button
              className="button ghost"
              onClick={() => setSetup(undefined)}
            >
              稍后
            </button>
            <span className="spacer" />
            <button
              className="button primary"
              onClick={() => {
                goSettings(setup.model);
                void resourceAction("prepare");
              }}
            >
              一键准备全部 <Icon name="download" size={15} />
            </button>
          </footer>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => closeConfirmation(false)}
        >
          <p className="confirmation-message">{confirmation.message}</p>
          <footer className="modal-footer">
            <button
              className="button ghost"
              onClick={() => closeConfirmation(false)}
            >
              取消
            </button>
            <span className="spacer" />
            <button
              className={`button ${confirmation.danger ? "danger" : "primary"}`}
              onClick={() => closeConfirmation(true)}
            >
              确认{confirmation.danger ? "删除" : ""}
            </button>
          </footer>
        </Modal>
      )}
      {renaming && (
        <Modal
          title="重命名声音"
          onClose={() => setRenaming(undefined)}
          busy={busy}
        >
          <div className="rename-body">
            <label className="form-field">
              声音名称
              <input
                value={rename}
                maxLength={40}
                onChange={(event) => setRename(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy) void renameVoice();
                }}
              />
            </label>
          </div>
          <footer className="modal-footer">
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => setRenaming(undefined)}
            >
              取消
            </button>
            <span className="spacer" />
            <button
              className="button primary"
              disabled={busy || !rename.trim()}
              onClick={() => void renameVoice()}
            >
              保存名称
            </button>
          </footer>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          {toast.path && (
            <button
              className="text-button"
              onClick={() => void reveal(toast.path!)}
            >
              打开文件夹
            </button>
          )}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast(undefined)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
