import type { Draft, Preferences } from "./types";

export const draftStorageKey = "vovo.draft.v1";
export const preferencesStorageKey = "vovo.preferences.v1";

// 同一份文稿和偏好只迁移一次，已有 vovo 数据优先。
function readStoredValue(key: string, legacyKey: string): string | null {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) {
    try {
      localStorage.setItem(key, legacy);
    } catch {
      // 存储已满时仍能读取原来的文稿，后续自动保存会提示失败。
    }
  }
  return legacy;
}

export const defaultDraft: Draft = {
  title: "",
  text: "",
  voiceKey: "zh:zf_001",
  speed: 1,
};
export const defaultPreferences: Preferences = {
  theme: "system",
  outputDir: "",
  autoExport: false,
  formats: ["mp3", "srt"],
  favorites: [],
  recent: [],
};

export function readDraft(): Draft {
  try {
    const value = JSON.parse(
      readStoredValue(draftStorageKey, "voicestudio.draft.v1") ?? "null",
    );
    if (!value || typeof value.text !== "string") return { ...defaultDraft };
    return {
      title: typeof value.title === "string" ? value.title.slice(0, 100) : "",
      text: value.text,
      voiceKey:
        typeof value.voiceKey === "string"
          ? value.voiceKey
          : defaultDraft.voiceKey,
      speed:
        typeof value.speed === "number" &&
        value.speed >= 0.8 &&
        value.speed <= 1.3
          ? value.speed
          : 1,
    };
  } catch {
    return { ...defaultDraft };
  }
}
export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(
      readStoredValue(preferencesStorageKey, "voicestudio.preferences.v1") ?? "null",
    );
    if (!value) return { ...defaultPreferences };
    const formats = Array.isArray(value.formats)
      ? value.formats.filter((f: unknown) =>
          ["mp3", "wav", "srt", "txt"].includes(String(f)),
        )
      : [];
    return {
      theme: ["system", "light", "dark"].includes(value.theme)
        ? value.theme
        : "system",
      outputDir: typeof value.outputDir === "string" ? value.outputDir : "",
      autoExport: value.autoExport === true,
      formats: formats.length ? formats : defaultPreferences.formats,
      favorites: Array.isArray(value.favorites)
        ? value.favorites.filter((s: unknown) => typeof s === "string")
        : [],
      recent: Array.isArray(value.recent)
        ? value.recent
            .filter((s: unknown) => typeof s === "string")
            .slice(0, 12)
        : [],
    };
  } catch {
    return { ...defaultPreferences };
  }
}
export function importText(text: string, markdown = false): string {
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (markdown)
    text = text
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "");
  return text.trim();
}
export function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
export function estimatedDuration(text: string, speed: number): string {
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const english = text
    .replace(/[\u3400-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const seconds = (chinese / 4 + english / 2.5) / speed;
  return seconds < 60
    ? `约 ${Math.max(1, Math.round(seconds))} 秒`
    : `约 ${(seconds / 60).toFixed(1)} 分钟`;
}
export const characterCount = (text: string) => Array.from(text).length;
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
