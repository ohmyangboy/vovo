import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, desktop } from "../api";
import type { ActiveJob, JobEvent } from "../types";

export type RunJob = <T>(
  kind: string,
  label: string,
  action: (id: string) => Promise<T>,
) => Promise<T | undefined>;
const stageLabels: Record<string, string> = {
  load: "正在载入声音…",
  synth: "正在生成配音…",
  encode: "整理音频与字幕…",
  reference: "正在准备参考片段…",
  transcription: "正在识别片段文字…",
  "transcription-resources": "首次使用，正在准备文字识别资源…",
  environment: "正在准备配音功能…",
  resources: "正在下载中文和英文声音…",
  samples: "正在准备声音试听…",
  "cloned-samples": "正在准备我的声音试听…",
  cloning: "正在准备我的声音…",
  ready: "全部准备完成，可以开始创作了",
};

export function useJobs(
  notify: (message: string, tone?: "error" | "success" | "info") => void,
  onEvent?: (event: JobEvent) => void,
) {
  const [active, setActive] = useState<ActiveJob | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const lock = useRef<ActiveJob | null>(null);
  const lastSequence = useRef(-1);
  const listener = useRef<Promise<unknown> | null>(null);
  const eventHandler = useRef(onEvent);
  eventHandler.current = onEvent;
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listener.current = listen<JobEvent>("studio-event", (event) => {
      const data = event.payload;
      if (
        !lock.current ||
        data.jobId !== lock.current.id ||
        data.sequence <= lastSequence.current
      )
        return;
      lastSequence.current = data.sequence;
      eventHandler.current?.(data);
      if (data.type === "progress") {
        const stage = data.stage ?? "download";
        const next = {
          ...lock.current,
          stage,
          done: data.done ?? 0,
          total: data.total ?? 0,
          voiceKey: data.voiceKey ?? (lock.current.kind === "prepare" && ["load", "synth", "encode"].includes(stage)
            ? lock.current.voiceKey : undefined),
          label: lock.current.kind === "prepare" && ["load", "synth", "encode"].includes(stage)
            ? "正在准备我的声音试听…"
            : stageLabels[stage] ?? data.label ?? lock.current.label,
        };
        lock.current = next;
        setActive(next);
      }
      if (data.type === "log" || data.type === "error") {
        const message = data.message ?? "";
        if (message) setLogs((previous) => [...previous, message].slice(-300));
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => notify(`任务状态监听失败：${String(error)}`, "error"));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notify]);

  const run: RunJob = useCallback(
    async (kind, label, action) => {
      if (lock.current) {
        notify("已有任务正在进行，请先等待或取消", "info");
        return undefined;
      }
      if (!desktop) {
        notify("当前是网页界面预览，请使用桌面应用生成语音", "info");
        return undefined;
      }
      const job: ActiveJob = {
        id: crypto.randomUUID(),
        kind,
        label,
        stage: "prepare",
        done: 0,
        total: 0,
        cancelling: false,
      };
      lock.current = job;
      lastSequence.current = -1;
      setActive(job);
      setLogs([]);
      try {
        await listener.current;
        return await action(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLogs((previous) => [...previous, message].slice(-300));
        notify(
          message.includes("已取消")
            ? kind === "prepare"
              ? "准备已暂停，完成的声音仍可播放，下次可继续准备"
              : "已取消，文稿和完成的记录仍保留"
            : kind === "prepare"
              ? /no space left|磁盘空间|disk full/i.test(message)
                ? "磁盘空间不足，请腾出空间后继续准备。已完成的声音会保留。"
                : "准备尚未完成，已完成的声音会保留。请检查网络后点击一键准备继续。"
              : message.slice(0, 260),
          message.includes("已取消") ? "info" : "error",
        );
        return undefined;
      } finally {
        lock.current = null;
        setActive(null);
      }
    },
    [notify],
  );
  const cancel = useCallback(async () => {
    if (!lock.current || lock.current.cancelling) return;
    const job = { ...lock.current, cancelling: true };
    lock.current = job;
    setActive(job);
    try {
      await api.cancelJob(job.id);
    } catch (error) {
      notify(`取消失败：${String(error)}`, "error");
      lock.current = { ...job, cancelling: false };
      setActive(lock.current);
    }
  }, [notify]);
  return { active, logs, run, cancel };
}
