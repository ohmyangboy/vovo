import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "声音库", exact: true }).click();
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
  await expect(page.locator(".selected-voice-button")).toContainText("Heart");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator(".selected-voice-button")).toContainText("Heart");
});

test("模型切换先选择兼容声音，弹窗不抢走输入焦点", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "本地生成", exact: false }).click();
  await page.getByLabel("本次配音方式").selectOption("en");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole("textbox", { name: "搜索声音" });
  await search.pressSequentially("Heart");
  await expect(search).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "选择声音 Heart", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".selected-voice-button")).toContainText(
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
  for (const name of ["声音库", "生成记录", "设置", "生成工作台"]) {
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
  await page.screenshot({ path: "/tmp/voice-studio-workspace-small.png" });
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
  await page.screenshot({ path: "/tmp/voice-studio-workspace.png" });
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.screenshot({ path: "/tmp/voice-studio-voices.png" });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.screenshot({ path: "/tmp/voice-studio-settings.png" });
  expect(errors).toEqual([]);
});
