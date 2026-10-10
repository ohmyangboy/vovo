import { expect, test } from "@playwright/test";
import { desktopFixture, setMode } from "./desktop.fixture";

test.beforeEach(async ({ page }) => {
  await desktopFixture(page);
  await page.goto("/");
});

test("已有声音可直接生成，缺失声音由一键准备处理", async ({ page }) => {
  await page.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command: string, args: unknown) => {
      const result = await invoke(command, args);
      if (command === "list_voices") {
        const chinese = result.models.find((model: any) => model.id === "zh");
        chinese.installed = false;
        chinese.voices.push({ id: "zf_002", group: "中文 · 女声", label: "", ready: false });
      }
      return result;
    };
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "刷新准备状态" }).click();
  await expect(page.getByText("2 / 3 个可播放", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "一键准备全部", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await page.getByRole("textbox", { name: "配音文稿" }).fill("这段文字使用已经缓存的声音。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".result-panel")).toBeVisible();
  await page.locator(".selected-voice-button").click();
  await page.getByRole("button", { name: "选择声音 中文女声 002", exact: true }).click();
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.getByRole("heading", { name: "先准备配音功能" })).toBeVisible();
});

test("生成、字幕校对、重新导出与记录使用同一份结果", async ({ page }) => {
  await page.getByRole("textbox", { name: "文稿标题" }).fill("完整配音流程");
  await page
    .getByRole("textbox", { name: "配音文稿" })
    .fill("你好，这是完整的配音与字幕流程。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  const result = page.getByRole("region", { name: "生成结果" });
  await expect(
    result.getByRole("heading", { name: "完整配音流程" }),
  ).toBeVisible();
  await expect(
    result.getByRole("button", { name: "播放音频", exact: true }),
  ).toBeVisible();
  await result.getByRole("tab", { name: /字幕/ }).click();
  await result.getByRole("button", { name: "校对字幕", exact: true }).click();
  await result
    .getByRole("textbox", { name: "第 1 条字幕内容" })
    .fill("已经校对的字幕。");
  await expect(
    result.getByRole("button", { name: "导出文件", exact: true }),
  ).toBeDisabled();
  await result.getByRole("button", { name: "保存字幕", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("字幕已保存");
  await result.getByRole("button", { name: "导出文件", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "导出 2 种文件", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("文件已导出");
  await page.getByRole("button", { name: "生成记录", exact: false }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText("完整配音流程");
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __STUDIO_TEST__: { calls: { command: string; args: any }[] };
        }
      ).__STUDIO_TEST__.calls,
  );
  expect(
    calls.filter((call) => call.command === "generate_workspace"),
  ).toHaveLength(1);
  expect(
    calls.find((call) => call.command === "export_bundle")?.args.formats,
  ).toEqual(["mp3", "srt"]);
});

test("取消和失败保留之前的成功版本，旧任务事件不会串入", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "配音文稿" });
  await editor.fill("第一份成功配音。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.getByRole("region", { name: "生成结果" })).toBeVisible();
  await setMode(page, "slow");
  await editor.fill("第二份文稿，即使取消也要保留。");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".job-progress")).toContainText("正在载入声音");
  await expect(page.locator(".job-progress")).not.toContainText("99 / 100");
  await page
    .locator(".job-progress")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("已取消");
  await expect(editor).toHaveValue("第二份文稿，即使取消也要保留。");
  await expect(page.getByRole("region", { name: "生成结果" })).toContainText(
    "之前的生成版本",
  );
  await setMode(page, "error");
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("模型返回异常");
  await expect(page.getByRole("region", { name: "生成结果" })).toBeVisible();
  await page.getByRole("button", { name: "生成记录", exact: false }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
});

test("授权后一键导入并自动识别，校验保存后回到统一生成工作台", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "配音文稿" })
    .fill("这段文稿用自己的声音朗读。");
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "克隆声音", exact: true }).click();
  const wizard = page.getByRole("dialog");
  await expect(
    wizard.getByRole("button", { name: "导入并识别", exact: false }),
  ).toBeDisabled();
  await expect(wizard.getByRole("button", { name: "导入录音并识别文字", exact: false })).toBeDisabled();
  await wizard.getByRole("checkbox").check();
  await wizard
    .getByRole("button", { name: "导入并识别", exact: false })
    .click();
  const transcript = wizard.getByRole("textbox", { name: "核对识别文字", exact: true });
  const confirmation = wizard.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" });
  const next = wizard.getByRole("button", { name: "确认并继续", exact: false });
  await expect(transcript).toHaveValue("这是参考录音里面实际说的话。");
  await expect(next).toBeDisabled();
  await confirmation.check();
  await expect(next).toBeEnabled();
  await transcript.fill("大家好，这是我校正后的参考文字。");
  await expect(confirmation).not.toBeChecked();
  await expect(next).toBeDisabled();
  await confirmation.check();
  await next.click();
  await wizard
    .getByRole("textbox", { name: "声音名称", exact: true })
    .fill("我的旁白");
  await wizard
    .getByRole("button", { name: "保存并使用声音", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "生成工作台", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".selected-voice-button")).toContainText(
    "我的旁白",
  );
  await expect(page.getByLabel("语速", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "配音文稿" })).toHaveValue(
    "这段文稿用自己的声音朗读。",
  );
  await page.getByRole("button", { name: "生成配音", exact: true }).click();
  await expect(page.getByRole("region", { name: "生成结果" })).toContainText(
    "我的旁白",
  );
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          __STUDIO_TEST__: { calls: { command: string; args: any }[] };
        }
      ).__STUDIO_TEST__.calls,
  );
  const reference = calls.find((call) => call.command === "prepare_reference")!;
  expect(reference.args.req).toEqual({ path: "/samples/reference.wav", start: 0, duration: 20, authorized: true });
  expect(calls.find((call) => call.command === "transcribe_reference")?.args.id).toBe(reference.args.jobId);
  expect(calls.find((call) => call.command === "save_voice")?.args.req.refText).toBe("大家好，这是我校正后的参考文字。");
  const request = calls.find((call) => call.command === "generate_workspace" && !call.args.req.preview)!.args.req;
  expect(request.model).toBe("clone");
  expect(request.voice).toBe("saved-voice-1");
  expect(request.speed).toBe(1);
});

test("自动识别失败保留可试听片段，可手填或重试而不重复导入", async ({ page }) => {
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.transcriptionMode = "error"; });
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "克隆声音", exact: true }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("checkbox").check();
  await wizard.getByRole("button", { name: "导入并识别", exact: false }).click();
  await expect(wizard.locator(".reference-preview")).toBeVisible();
  await expect(wizard.getByText("未能自动识别。可以重新识别，或试听后手动补全文字。", { exact: true })).toBeVisible();
  const transcript = wizard.getByRole("textbox", { name: "核对识别文字", exact: true });
  await transcript.fill("试听后手动补全的文字。");
  await wizard.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" }).check();
  await expect(wizard.getByRole("button", { name: "确认并继续", exact: false })).toBeEnabled();
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.transcriptionMode = "success"; });
  await wizard.getByRole("button", { name: "重新识别", exact: true }).click();
  await expect(transcript).toHaveValue("这是参考录音里面实际说的话。");
  await expect(wizard.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" })).not.toBeChecked();
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  expect(calls.filter((call: any) => call.command === "prepare_reference")).toHaveLength(1);
  expect(calls.filter((call: any) => call.command === "transcribe_reference")).toHaveLength(2);
});

test("取消重新识别保留校正文字，识别期间不可跳过校验", async ({ page }) => {
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "克隆声音", exact: true }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("checkbox").check();
  await wizard.getByRole("button", { name: "导入并识别", exact: false }).click();
  const transcript = wizard.getByRole("textbox", { name: "核对识别文字", exact: true });
  await expect(transcript).toHaveValue("这是参考录音里面实际说的话。");
  await transcript.fill("已经校正的文字，取消后仍保留。");
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.transcriptionMode = "slow"; });
  await wizard.getByRole("button", { name: "重新识别", exact: true }).click();
  await expect(transcript).toBeDisabled();
  await expect(wizard.getByRole("button", { name: "确认并继续", exact: false })).toBeDisabled();
  await expect(wizard.locator(".job-progress")).toContainText("正在识别片段文字");
  await expect(wizard.locator(".job-progress")).not.toContainText("99%");
  await wizard.locator(".job-progress").getByRole("button", { name: "取消", exact: true }).click();
  await expect(wizard.getByText("识别已取消。可以重新识别，或试听后手动补全文字。", { exact: true })).toBeVisible();
  await expect(transcript).toBeEnabled();
  await expect(transcript).toHaveValue("已经校正的文字，取消后仍保留。");
});

test("调整片段后重新读取与识别，旧文字不得直接用于新片段", async ({ page }) => {
  await page.getByRole("button", { name: "声音库", exact: true }).click();
  await page.getByRole("button", { name: "克隆声音", exact: true }).click();
  const wizard = page.getByRole("dialog");
  await wizard.getByRole("checkbox").check();
  await wizard.getByRole("button", { name: "导入并识别", exact: false }).click();
  await expect(wizard.getByRole("textbox", { name: "核对识别文字", exact: true })).toHaveValue("这是参考录音里面实际说的话。");
  await wizard.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" }).check();
  await wizard.locator("summary", { hasText: "调整参考片段" }).click();
  await wizard.getByRole("spinbutton", { name: "从第几秒开始" }).fill("5");
  await wizard.getByRole("slider", { name: /片段长度/ }).press("Home");
  await expect(wizard.getByRole("button", { name: "确认并继续", exact: false })).toBeDisabled();
  await expect(wizard.getByRole("button", { name: "重新识别", exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).__STUDIO_TEST__.transcriptionText = "这是新选片段里说的话。"; });
  await wizard.getByRole("button", { name: "重新读取并识别", exact: true }).click();
  await expect(wizard.getByRole("textbox", { name: "核对识别文字", exact: true })).toHaveValue("这是新选片段里说的话。");
  await expect(wizard.getByRole("checkbox", { name: "我已试听并确认文字与片段一致" })).not.toBeChecked();
  const calls = await page.evaluate(() => (window as any).__STUDIO_TEST__.calls);
  const references = calls.filter((call: any) => call.command === "prepare_reference");
  const transcripts = calls.filter((call: any) => call.command === "transcribe_reference");
  expect(references).toHaveLength(2);
  expect(references[1].args.req).toEqual({ path: "/samples/reference.wav", start: 5, duration: 3, authorized: true });
  expect(transcripts[1].args.id).toBe(references[1].args.jobId);
  expect(transcripts[1].args.id).not.toBe(transcripts[0].args.id);
});
