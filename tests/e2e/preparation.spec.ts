import { expect, test } from "@playwright/test";
import { desktopFixture } from "./desktop.fixture";

test.beforeEach(async ({ page }) => {
  await desktopFixture(page);
  await page.addInitScript(() => {
    (window as any).__STUDIO_TEST__.includePendingVoices = true;
  });
  await page.goto("/");
});

test("一键准备，声音库即时显示可播放、准备中和等待准备", async ({ page }) => {
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.prepareMode = "slow"; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByText("2 / 4 个可播放", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /补齐声音|准备环境|下载模型/ })).toHaveCount(0);
  await page.getByRole("button", { name: "一键准备全部", exact: true }).click();
  await expect(page.locator(".job-progress")).toContainText("2 / 4 个声音");
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  const first = page.locator(".voice-tile").filter({ has: page.getByRole("button", { name: "选择声音 中文女声 001", exact: true }) });
  const current = page.locator(".voice-tile").filter({ has: page.getByRole("button", { name: "选择声音 中文女声 002", exact: true }) });
  const pending = page.locator(".voice-tile").filter({ has: page.getByRole("button", { name: "选择声音 中文女声 003", exact: true }) });
  await expect(first).toContainText("可播放");
  await expect(current).toContainText("准备中");
  await expect(pending).toContainText("等待准备");
  await expect(current.getByRole("button", { name: "试听 中文女声 002", exact: true })).toBeDisabled();
  await expect(first.getByRole("button", { name: "试听 中文女声 001", exact: true })).toBeEnabled();
  await first.getByRole("button", { name: "试听 中文女声 001", exact: true }).click();
  await expect(page.getByText("正在试听 · 中文女声 001", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/voice-studio-preparation-in-progress.png" });
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.completePrepare(); });
  await expect(current).toContainText("可播放");
  await expect(pending).toContainText("可播放");
  await current.getByRole("button", { name: "试听 中文女声 002", exact: true }).click();
  await expect(page.getByText("正在试听 · 中文女声 002", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  expect(calls.filter((call: any) => call.command === "prepare_studio")).toHaveLength(1);
  expect(calls.filter((call: any) => ["install_engine", "download_model", "setup_clone", "download_clone", "generate_workspace"].includes(call.command))).toHaveLength(0);
});

test("暂停后已有试听仍可播放，继续准备不会丢掉文稿", async ({ page }) => {
  await page.getByRole("textbox", { name: "配音文稿" }).fill("准备声音期间也保留这份文稿。");
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.prepareMode = "slow"; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "一键准备全部", exact: true }).click();
  await page.locator(".job-progress").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("完成的声音仍可播放");
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(page.getByText("正在试听 · Heart", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.prepareMode = "success"; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "一键准备全部", exact: true }).click();
  await expect(page.getByText("4 / 4 个可播放", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "检查并准备", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue("准备声音期间也保留这份文稿。");
});

test("完成的试听可直接播放，清理文稿缓存保留声音库试听", async ({ page }) => {
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(page.getByText("正在试听 · Heart", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "清理缓存", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("声音库已准备好的试听");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await expect(page.getByRole("button", { name: "试听 Heart", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(page.getByText("正在试听 · Heart", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  expect(calls.filter((call: any) => call.command === "generate_workspace")).toHaveLength(0);
});

test("准备失败保留可播放的声音，重试完成剩余部分", async ({ page }) => {
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.prepareMode = "error"; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "一键准备全部", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已完成的声音会保留");
  await expect(page.getByText("2 / 4 个可播放", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "试听 Heart", exact: true }).click();
  await expect(page.getByText("正在试听 · Heart", { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.prepareMode = "success"; });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "一键准备全部", exact: true }).click();
  await expect(page.getByText("4 / 4 个可播放", { exact: true })).toBeVisible();
});
