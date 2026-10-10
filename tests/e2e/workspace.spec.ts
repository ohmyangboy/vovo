import { expect, test } from "@playwright/test";
import { openVoicePicker } from "./desktop.fixture";

test("vovo 品牌和图标已更新，旧草稿及偏好可以接续保存", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("voicestudio.draft.v1")) {
      localStorage.setItem("voicestudio.draft.v1", JSON.stringify({ title: "升级前文稿", text: "这份文稿来自旧版。", voiceKey: "en:af_heart", speed: 1 }));
      localStorage.setItem("voicestudio.preferences.v1", JSON.stringify({ theme: "dark", favorites: ["en:af_heart"], formats: ["mp3", "srt"] }));
    }
  });
  await page.goto("/");
  await expect(page).toHaveTitle("vovo");
  await expect(page.locator(".brand strong")).toHaveText("vovo");
  await expect(page.getByText(/VOICE STUDIO|VoiceStudio|配音工坊/)).toHaveCount(0);
  await expect(page.locator(".brand img")).toHaveAttribute("src", "/vovo-logo.png");
  expect(await page.locator(".brand img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue("这份文稿来自旧版。");
  await expect(page.locator(".compose-voice")).toContainText("Heart");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("textbox", { name: "配音文稿" }).fill("在 vovo 继续编辑。");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("vovo.draft.v1") || "{}").text)).toBe("在 vovo 继续编辑。");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue("在 vovo 继续编辑。");
});

test("工作台不要求先安装环境，配置有独立入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "生成工作台" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toBeEditable();
  await expect(page.getByText("准备环境", { exact: true })).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "配音文稿" })
    .fill("购买价 19.99 元。请保留【重要条款】。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("网页预览");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "配音准备" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "一键准备全部", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue(
    "购买价 19.99 元。请保留【重要条款】。",
  );
});

test("文稿、声音与主题重启后恢复", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "文稿标题" }).fill("我的第一份配音");
  await page
    .getByRole("textbox", { name: "配音文稿" })
    .fill("这里是完整的文稿，不藏在弹窗里。\n\n第二段同样可以编辑。");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.waitForTimeout(550);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "文稿标题" })).toHaveValue(
    "我的第一份配音",
  );
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue(
    /这里是完整的文稿/,
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("声音可以搜索、收藏并回到同一个工作台", async ({ page }) => {
  await page.goto("/");
  await openVoicePicker(page);
  await page.getByRole("textbox", { name: "搜索声音" }).fill("Heart");
  await expect(
    page.getByRole("button", { name: "选择声音 Heart", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "收藏 Heart", exact: true }).click();
  await page.getByRole("tab", { name: "收藏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "选择声音 Heart", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "选择声音 Heart", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "生成工作台" })).toBeVisible();
  await expect(page.locator(".compose-voice")).toContainText("Heart");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator(".compose-voice")).toContainText("Heart");
});

test("选择声音时按语言筛选，弹窗不抢走输入焦点", async ({ page }) => {
  await page.goto("/");
  await page.locator(".compose-voice").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("筛选声音语言").selectOption("en");
  const search = dialog.getByRole("textbox", { name: "搜索声音" });
  await search.click();
  await search.pressSequentially("Heart");
  await expect(search).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "选择声音 Heart", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".compose-voice")).toContainText(
    "中文女声 001",
  );
});

test("最小窗口与深色模式没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 620 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "生成配音", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("textbox", { name: "配音文稿" }),
  ).toBeInViewport();
  await openVoicePicker(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  for (const name of ["设置", "生成工作台"]) {
    await page.getByRole("button", { name, exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "生成配音", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: "/tmp/vovo-workspace-small.png" });
});

test("主界面没有运行错误，可体验示例文稿", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "试试示例文稿", exact: false })
    .click();
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue(
    /有些文字，值得被听见/,
  );
  await page.screenshot({ path: "/tmp/vovo-workspace.png" });
  await openVoicePicker(page);
  await page.screenshot({ path: "/tmp/vovo-voices.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: "/tmp/vovo-settings.png" });
  expect(errors).toEqual([]);
});
