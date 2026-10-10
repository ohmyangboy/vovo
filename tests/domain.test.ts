import { strict as assert } from "node:assert";
import { test, beforeEach } from "node:test";
import {
  characterCount,
  defaultDraft,
  defaultPreferences,
  formatDuration,
  importText,
  readDraft,
  readPreferences,
} from "../src/domain.ts";
import { initialModels, voiceChoices } from "../src/catalog.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
});

test("没有草稿和损坏数据时使用安全默认值", () => {
  assert.deepEqual(readDraft(), defaultDraft);
  localStorage.setItem("voicestudio.draft.v1", "{broken");
  assert.deepEqual(readDraft(), defaultDraft);
  localStorage.setItem(
    "voicestudio.draft.v1",
    JSON.stringify({ text: "中文", speed: 999, title: 12 }),
  );
  assert.equal(readDraft().speed, 1);
  assert.equal(readDraft().title, "");
  assert.equal(readDraft().text, "中文");
});
test("导出偏好过滤非法格式并至少保留一个默认格式", () => {
  localStorage.setItem(
    "voicestudio.preferences.v1",
    JSON.stringify({
      theme: "unknown",
      formats: ["exe"],
      favorites: ["zh:zf_001", 12],
    }),
  );
  const preferences = readPreferences();
  assert.equal(preferences.theme, "system");
  assert.deepEqual(preferences.formats, defaultPreferences.formats);
  assert.deepEqual(preferences.favorites, ["zh:zf_001"]);
});
test("导入处理保留正常括号、数字和段落", () => {
  assert.equal(
    importText(
      "\uFEFF# 文稿\r\n\r\n**价格 19.99 元**，保留【条款】与[名称]。",
      true,
    ),
    "文稿\n\n价格 19.99 元，保留【条款】与[名称]。",
  );
});
test("未安装模型也能浏览完整已支持声音目录", () => {
  const voices = voiceChoices(initialModels, []);
  assert.equal(voices.filter((v) => v.model === "zh").length, 103);
  assert.equal(voices.filter((v) => v.model === "en").length, 28);
  assert.equal(voices.find((v) => v.key === "zh:zf_001")?.name, "中文女声 001");
  assert.equal(voices.find((v) => v.key === "en:af_heart")?.name, "Heart");
  assert.ok(voices.every((v) => !v.ready));
});
test("Unicode 字数和音频时长展示稳定", () => {
  assert.equal(characterCount("你好🎙"), 3);
  assert.equal(formatDuration(61.9), "1:01");
  assert.equal(formatDuration(Infinity), "0:00");
});

test("模型音色未全部下载时，已缓存声音仍可使用", () => {
  const voices = voiceChoices([
    {
      ...initialModels[0],
      installed: false,
      voices: [
        { id: "zf_001", group: "中文", label: "", ready: true },
        { id: "zf_002", group: "中文", label: "", ready: false },
      ],
    },
  ], []);
  assert.equal(voices.find((v) => v.id === "zf_001")?.ready, true);
  assert.equal(voices.find((v) => v.id === "zf_002")?.ready, false);
});
