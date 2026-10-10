import type { ModelInfo, SavedVoice, VoiceChoice } from "./types";

const female = [
  1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 32, 36, 38,
  39, 40, 42, 43, 44, 46, 47, 48, 49, 51, 59, 60, 67, 70, 71, 72, 73, 74, 75,
  76, 77, 78, 79, 83, 84, 85, 86, 87, 88, 90, 92, 93, 94, 99,
];
const male = [
  9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 29, 30, 31, 33, 34, 35, 37, 41, 45, 50,
  52, 53, 54, 55, 56, 57, 58, 61, 62, 63, 64, 65, 66, 68, 69, 80, 81, 82, 89,
  91, 95, 96, 97, 98, 100,
];
const english = [
  ["af_heart", "温暖自然"],
  ["af_bella", "明亮有表现力"],
  ["af_nicole", "柔和气声"],
  ["af_sarah", "清晰播报"],
  ["af_sky", "轻快"],
  ["af_aoede", "沉稳"],
  ["af_kore", ""],
  ["af_nova", ""],
  ["af_jessica", ""],
  ["af_river", ""],
  ["af_alloy", ""],
  ["am_michael", "沉稳"],
  ["am_fenrir", "浑厚有力"],
  ["am_onyx", "低沉"],
  ["am_puck", "活泼"],
  ["am_adam", ""],
  ["am_echo", ""],
  ["am_eric", ""],
  ["am_liam", ""],
  ["am_santa", ""],
  ["bf_emma", "清晰"],
  ["bf_alice", ""],
  ["bf_isabella", ""],
  ["bf_lily", ""],
  ["bm_george", "沉稳"],
  ["bm_daniel", ""],
  ["bm_fable", ""],
  ["bm_lewis", ""],
];

// 未安装环境时也可以浏览目录。
export const initialModels: ModelInfo[] = [
  {
    id: "zh",
    name: "Kokoro 中英双语 v1.1-zh",
    desc: "中文与中英混读，103 个预设声音",
    installed: false,
    sizeMB: 0,
    voices: [
      ...female.map((n) => ({
        id: `zf_${String(n).padStart(3, "0")}`,
        group: "中文 · 女声",
        label: "",
      })),
      ...male.map((n) => ({
        id: `zm_${String(n).padStart(3, "0")}`,
        group: "中文 · 男声",
        label: "",
      })),
      ...["af_maple", "af_sol", "bf_vale"].map((id) => ({
        id,
        group: id.startsWith("b") ? "英式英语 · 女声" : "美式英语 · 女声",
        label: "",
      })),
    ],
  },
  {
    id: "en",
    name: "Kokoro 英文 v1.0",
    desc: "美式与英式英语",
    installed: false,
    sizeMB: 0,
    voices: english.map(([id, label]) => ({
      id,
      label,
      group: `${id.startsWith("b") ? "英式" : "美式"}英语 · ${id[1] === "f" ? "女声" : "男声"}`,
    })),
  },
];

export const modelNames = { zh: "中文配音", en: "英文配音", clone: "声音克隆" };
export function friendlyVoice(id: string): string {
  if (/^z[fm]_\d+$/.test(id))
    return `中文${id[1] === "f" ? "女声" : "男声"} ${id.split("_")[1]}`;
  const name = id.split("_").slice(1).join(" ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
export function voiceChoices(
  models: ModelInfo[],
  saved: SavedVoice[],
): VoiceChoice[] {
  return [
    ...models.flatMap((model) =>
      model.voices
        .filter((v) =>
          model.id === "en" ? /^[ab]/.test(v.id) : /^[abz]/.test(v.id),
        )
        .map((v) => ({
          key: `${model.id}:${v.id}`,
          id: v.id,
          model: model.id as "en" | "zh",
          name: friendlyVoice(v.id),
          kind: "preset" as const,
          language: v.id.startsWith("z") ? ("zh" as const) : ("en" as const),
          group: v.id.startsWith("z")
            ? `中文 · ${v.id[1] === "f" ? "女声" : "男声"}`
            : `${v.id.startsWith("b") ? "英式" : "美式"}英语 · ${v.id[1] === "f" ? "女声" : "男声"}`,
          description: v.label.replace(/（推荐）/g, ""),
          ready: v.ready ?? model.installed,
          previewAudio: v.previewAudio,
          previewDuration: v.previewDuration,
        })),
    ),
    ...saved.map((voice) => ({
      key: `clone:${voice.id}`,
      id: voice.id,
      model: "clone" as const,
      name: voice.name,
      kind: "cloned" as const,
      language: "zh" as const,
      group: "我的声音 · 中文",
      description: `${voice.duration.toFixed(1)} 秒参考录音`,
      ready: true,
      previewAudio: voice.previewAudio ?? undefined,
    })),
  ];
}
