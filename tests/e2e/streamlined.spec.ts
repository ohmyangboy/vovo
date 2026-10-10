import { expect, test } from "@playwright/test";
import { desktopFixture, openVoicePicker } from "./desktop.fixture";

test.beforeEach(async ({ page }) => { await desktopFixture(page); await page.goto("/"); });

test("声音试听嵌入对应卡片，支持进度与拖动，关闭选声即停止", async ({ page }) => {
  await expect(page.locator(".inline-preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "声音库", exact: true })).toHaveCount(0);
  await openVoicePicker(page);
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  const card = page.locator(".voice-tile").filter({ has: page.getByRole("button", { name: "选择声音 Heart", exact: true }) });
  const player = card.getByRole("group", { name: "试听 Heart", exact: true });
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: "暂停音频", exact: true })).toBeVisible();
  await expect(player.locator(".player-error")).toHaveCount(0);
  await expect(page.locator(".sample-player")).toHaveCount(0);
  await player.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.pause(); audio.currentTime = 1.25; audio.dispatchEvent(new Event("timeupdate"));
  });
  const progress = player.getByRole("slider", { name: "音频播放位置" });
  await expect(progress).toHaveValue("1.25");
  await progress.press("ArrowRight");
  await expect(progress).toHaveValue("1.26");
  expect(await player.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(1.26);
  await page.screenshot({ path: "/tmp/vovo-inline-voice-preview.png" });
  await player.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.pause(); audio.dispatchEvent(new Event("ended")); });
  await expect(player).toHaveCount(0);
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(player).toBeVisible();
  await player.locator("audio").evaluate((audio: HTMLAudioElement) => { (window as any).__LAST_AUDIO_TEST__ = audio; });
  await page.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__LAST_AUDIO_TEST__.paused)).toBe(true);
});

test("英文试听保留完整长句，紧凑菜单按需展开并可用键盘关闭", async ({ page }) => {
  await expect(page.getByRole("slider", { name: "配音语速" })).toHaveCount(0);
  await page.getByLabel("调整语速", { exact: true }).click();
  await page.getByRole("slider", { name: "配音语速" }).press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("调整语速", { exact: true })).toBeFocused();
  await expect(page.getByRole("slider", { name: "配音语速" })).toHaveCount(0);
  await page.locator(".compose-voice").click();
  await page.getByRole("dialog").getByLabel("筛选声音语言").selectOption("en");
  await page.getByRole("button", { name: "选择声音 Heart", exact: true }).click();
  const text = "Over two years ago, we wrote a detailed deconstruction of this idea and argued that its primary effect was to turn vague fears into seemingly precise numbers.";
  await page.getByRole("textbox", { name: "配音文稿" }).fill(text);
  await page.getByRole("button", { name: "试听文稿", exact: true }).click();
  const player = page.getByRole("group", { name: "文稿试听", exact: true });
  await expect(player).toBeVisible();
  await expect(page.locator(".studio-footer").getByRole("slider", { name: "音频播放位置" })).toBeVisible();
  await expect(page.locator(".sample-player")).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  const request = calls.find((call: any) => call.command === "generate_workspace").args.req;
  expect(request.text).toBe(text);
  expect(request.speed).toBe(1.05);
});

test("给已有声音补充英文录音，保留原声音并在英文筛选下可选择", async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__STUDIO_TEST__;
    state.savedVoices.push({ id: "my-voice", name: "我的旁白", model: "clone", language: "zh",
      reference: "/managed/voice/reference.wav", refText: "原来的中文录音。", duration: 20,
      createdAt: 1, authorizedAt: 1, previewAudio: "/managed/voice/preview.mp3", references: [] });
    state.transcriptionText = "This is my English reference recording, spoken clearly and naturally.";
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "刷新准备状态", exact: true }).click();
  await openVoicePicker(page);
  await page.getByRole("tab", { name: /我的声音/ }).click();
  await page.getByLabel("管理声音 我的旁白", { exact: true }).click();
  await page.getByRole("button", { name: "补充参考录音", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "补充参考录音", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "导入录音并识别文字", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "核对识别文字" })).toHaveValue(/This is my English/);
  await expect(dialog.getByRole("button", { name: "保存参考录音", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" }).check();
  await dialog.getByRole("button", { name: "保存参考录音", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openVoicePicker(page);
  await page.getByRole("tab", { name: /我的声音/ }).click();
  await expect(page.locator(".voice-tile")).toHaveCount(1);
  await expect(page.locator(".voice-tile")).toContainText("2 段参考录音");
  await page.getByLabel("筛选声音语言").selectOption("en");
  await expect(page.getByRole("button", { name: "选择声音 我的旁白", exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  expect(calls.find((call: any) => call.command === "add_voice_reference").args).toMatchObject({ id: "my-voice", authorized: true });
  expect(calls.filter((call: any) => call.command === "generate_workspace")).toHaveLength(0);
});
