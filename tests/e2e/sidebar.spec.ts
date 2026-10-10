import { expect, test } from "@playwright/test";
import { desktopFixture, openVoicePicker, setMode } from "./desktop.fixture";

test.beforeEach(async ({ page }) => { await desktopFixture(page); await page.goto("/"); });

test("生成后即刻加入侧栏，查看旧记录不改变草稿，继续编辑需确认", async ({ page }) => {
  const title = page.getByRole("textbox", { name: "文稿标题" });
  const editor = page.getByRole("textbox", { name: "配音文稿" });
  await title.fill("第一份配音");
  await editor.fill("第一份文稿。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(1);
  await title.fill("第二份配音");
  await editor.fill("第二份文稿。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(2);
  await expect(page.locator(".sidebar-record").first()).toContainText("第二份配音");
  await editor.fill("尚未生成的新草稿。");
  await page.getByRole("button", { name: "打开记录 第一份配音", exact: true }).click();
  await expect(page.getByRole("region", { name: "生成结果" })).toContainText("第一份配音");
  await expect(page.getByRole("button", { name: "打开记录 第一份配音", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".history-source")).toContainText("第一份文稿。");
  await page.getByRole("button", { name: "生成工作台", exact: true }).click();
  await expect(editor).toHaveValue("尚未生成的新草稿。");
  await page.getByRole("button", { name: "打开记录 第一份配音", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toContainText("使用这份文稿？");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "生成工作台", exact: true }).click();
  await expect(editor).toHaveValue("尚未生成的新草稿。");
  await page.getByRole("button", { name: "打开记录 第一份配音", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(editor).toHaveValue("第一份文稿。");
  await expect(title).toHaveValue("第一份配音");
  await expect(page.locator(".sidebar-record")).toHaveCount(2);
  await page.screenshot({ path: "/tmp/vovo-sidebar-records.png" });
});

test("记录可直接导出、删除；删除当前项选择下一项，最后一项删除后返回草稿", async ({ page }) => {
  for (const name of ["保留记录", "删除记录"]) {
    await page.getByRole("textbox", { name: "文稿标题" }).fill(name);
    await page.getByRole("textbox", { name: "配音文稿" }).fill(`${name}的文稿。`);
    await page.getByRole("button", { name: "生成配音", exact: true }).click();
    await expect(page.locator(".sidebar-record").first()).toContainText(name);
  }
  await page.getByRole("button", { name: "打开记录 删除记录", exact: true }).click();
  await page.getByRole("button", { name: "导出文件", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("文件已导出");
  await page.getByRole("button", { name: "删除记录 删除记录", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "生成结果" })).toContainText("保留记录");
  await page.getByRole("button", { name: "删除记录 保留记录", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue("删除记录的文稿。");
  await expect(page.getByRole("region", { name: "生成结果" })).toHaveCount(0);
});

test("长记录列表独立滚动，小窗口下选声和设置可用，新记录自动出现在顶部", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.evaluate(() => {
    const records = (window as any).__STUDIO_TEST__.records;
    for (let i = 0; i < 35; i++) records.push({ id: `seed-${i}`, title: `历史配音 ${i + 1}：一个很长的标题用来验证省略显示`,
      text: "这是一份历史文稿。", model: "zh", voice: "zf_001", voiceName: "中文女声 001", speed: 1,
      createdAt: Date.now() - i * 60000, duration: 3, sampleRate: 24000,
      wav: "/managed/seed.wav", mp3: "/managed/seed.mp3", srt: "/managed/seed.srt", txt: "/managed/seed.txt",
      captions: [{ start: 0, end: 3, text: "这是一份历史文稿。" }], captionRevision: 0, preview: false });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "刷新准备状态", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(35);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  const list = page.locator(".sidebar-history-list");
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeInViewport();
  await page.locator(".sidebar-record").last().click();
  await expect(page.getByRole("region", { name: "生成结果" })).toBeVisible();
  await page.screenshot({ path: "/tmp/vovo-history-small.png" });
  await openVoicePicker(page);
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  const preview = page.getByRole("group", { name: "试听 Heart", exact: true });
  await expect(preview.getByRole("slider", { name: "音频播放位置" })).toBeInViewport();
  await preview.getByRole("button", { name: "暂停音频", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "文稿标题" }).fill("刚完成的配音");
  await page.getByRole("textbox", { name: "配音文稿" }).fill("新配音自动加入左侧。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".sidebar-record")).toHaveCount(36);
  await expect(page.locator(".sidebar-record").first()).toContainText("刚完成的配音");
  expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "试听文稿", exact: true }).click();
  const workspacePreview = page.getByRole("group", { name: "文稿试听", exact: true });
  await expect(workspacePreview.getByRole("slider", { name: "音频播放位置" })).toBeVisible();
  await workspacePreview.getByRole("button", { name: "暂停音频", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成配音", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/vovo-inline-workspace-small.png" });
});

test("关闭选声会取消未完成的声音试听，缓存试听与结果播放互不重叠", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__STUDIO_TEST__.savedVoices.push({ id: "pending-voice", name: "待试听的声音", model: "clone", language: "zh",
      reference: "/managed/reference.wav", refText: "参考录音。", duration: 20, createdAt: 1, authorizedAt: 1 });
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "刷新准备状态", exact: true }).click();
  await setMode(page, "slow");
  await openVoicePicker(page);
  await page.getByRole("tab", { name: /我的声音/ }).click();
  await page.getByRole("button", { name: "试听 待试听的声音", exact: true }).click();
  await expect(page.locator(".voice-tile")).toContainText("准备中");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".job-progress")).toHaveCount(0);
  await expect(page.locator(".inline-preview")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__STUDIO_TEST__.calls.some((call: any) => call.command === "cancel_job"))).toBe(true);
  await page.getByRole("textbox", { name: "配音文稿" }).fill("可以继续生成。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  const result = page.getByRole("region", { name: "生成结果" });
  await result.getByRole("button", { name: "播放音频", exact: true }).click();
  await result.locator("audio").evaluate((audio: HTMLAudioElement) => { (window as any).__RESULT_AUDIO_TEST__ = audio; });
  await openVoicePicker(page);
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(page.getByRole("group", { name: "试听 Heart", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__RESULT_AUDIO_TEST__.paused)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".inline-preview")).toHaveCount(0);
});
