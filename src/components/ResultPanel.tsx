import { useEffect, useState } from "react";
import { formatDuration } from "../domain";
import type { ActiveJob, Bundle, Caption, PreviewPlayback } from "../types";
import { AudioPlayer } from "./AudioPlayer";
import { ControlMenu } from "./ControlMenu";
import { Icon } from "./Icon";
import { JobProgress } from "./JobProgress";
import { Modal } from "./Modal";

export function ResultPanel({ bundle, outdated = false, busy, onExport, onExportOptions,
  onSaveCaptions, onCopy, onReveal, summary, preview, onDismissPreview, onPreview,
  onGenerate, canGenerate = false, job, onCancel,
}: {
  bundle?: Bundle;
  outdated?: boolean;
  busy: boolean;
  onExport: (bundle: Bundle) => void;
  onExportOptions: (bundle: Bundle) => void;
  onSaveCaptions: (bundle: Bundle, captions: Caption[]) => Promise<void>;
  onCopy: (text: string) => void;
  onReveal: (path: string) => void;
  summary?: { count: number; limit: number; estimate: string; saved: boolean };
  preview?: PreviewPlayback;
  onDismissPreview: () => void;
  onPreview?: () => void;
  onGenerate?: () => void;
  canGenerate?: boolean;
  job: ActiveJob | null;
  onCancel: () => void;
}) {
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [time, setTime] = useState(0);
  const [captions, setCaptions] = useState(bundle?.captions ?? []);
  const [editing, setEditing] = useState(false);
  const [seek, setSeek] = useState<{ time: number; id: number }>();
  useEffect(() => {
    setCaptions(bundle?.captions ?? []);
    setEditing(false);
  }, [bundle?.id, bundle?.captionRevision, bundle?.captions]);
  const dirty = captions.some((caption, index) => caption.text !== bundle?.captions[index]?.text);
  const valid = captions.every((caption) => caption.text.trim());
  const audioPath = preview?.path ?? bundle?.wav;
  useEffect(() => { setTime(0); setSeek(undefined); }, [audioPath]);
  const stats = summary && (
    <span className={`footer-stats${summary.count > summary.limit ? " invalid" : ""}`}>
      {summary.count.toLocaleString()} / {summary.limit.toLocaleString()} 字
      {summary.count > 0 && <> · {summary.estimate}</>}
    </span>
  );
  return (
    <>
      <footer className={`studio-footer${audioPath ? " has-audio" : ""}${preview ? " previewing" : ""}`}
        role="region" aria-label={bundle ? "生成结果" : "配音操作"}>
        <div className="footer-info">
          {preview ? <><strong>文稿试听</strong><span>{preview.name}</span></>
            : bundle ? <><h2>{bundle.title}</h2><span>{bundle.voiceName}{dirty ? " · 字幕待保存" : " · 已生成"}</span></>
            : <>{stats}<span>{summary?.saved ? "文稿已保存" : "正在保存…"}</span></>}
          {bundle && summary && <div className="footer-document-meta">{stats}</div>}
        </div>
        {audioPath && <div className="footer-player" role="group" aria-label={preview ? "文稿试听" : "配音播放"}>
          <AudioPlayer key={preview ? preview.path + preview.startedAt : bundle?.id}
            path={audioPath} duration={preview?.duration ?? bundle?.duration}
            compact={!!preview} autoPlay={!!preview} onTimeChange={setTime} seekRequest={preview ? undefined : seek}
            onFinished={preview ? onDismissPreview : undefined} onInterrupted={preview ? onDismissPreview : undefined} />
          {preview && <button className="icon-button" aria-label="结束文稿试听" onClick={onDismissPreview}><Icon name="close" size={15} /></button>}
        </div>}
        <div className="footer-actions">
          {onPreview && !preview && <button className="button ghost footer-preview" aria-label="试听文稿" disabled={!canGenerate || busy}
            onClick={onPreview} title="试听文稿；选中文字可只试听选中部分">
            <Icon name="play" size={16} /><span>试听文稿</span>
          </button>}
          {bundle && !preview && <>
            <button className="button ghost footer-captions" aria-label={dirty ? "字幕（有未保存修改）" : "字幕"}
              title="查看与校对字幕" onClick={() => setCaptionsOpen(true)}>
              <Icon name="file" size={16} /><span>字幕</span>{dirty && <i className="unsaved-dot" />}
            </button>
            <button className="button secondary footer-export" aria-label="导出文件" disabled={busy || dirty} onClick={() => onExport(bundle)}>
              <Icon name="download" size={16} /><span>导出</span>
            </button>
          </>}
          {onGenerate && <button className="button primary" disabled={!canGenerate || busy} onClick={onGenerate} title="⌘ / Ctrl + Enter 生成配音">
            {job?.kind === "generate" ? <span className="spinner" /> : <Icon name="wave" size={18} />}生成配音
          </button>}
          {bundle && !preview && <ControlMenu className="footer-menu" label="更多配音操作" trigger={<Icon name="more" size={17} />}>
            <div className="control-popover menu-actions">
              <button disabled={busy || dirty} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); onExportOptions(bundle); }}>导出位置与格式</button>
              <button onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); onReveal(bundle.wav); }}>在文件夹中显示音频</button>
              <button onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); onReveal(bundle.srt); }}>在文件夹中显示字幕</button>
            </div>
          </ControlMenu>}
        </div>
        {outdated && !preview && <p className="footer-version-notice">文稿或声音已修改，当前播放的是之前的生成版本。</p>}
        {job && ["generate", "preview"].includes(job.kind) && <JobProgress job={job} onCancel={onCancel} />}
      </footer>
      {bundle && captionsOpen && <Modal title="字幕" description={bundle.title} wide onClose={() => setCaptionsOpen(false)}>
        <div className="caption-dialog-body">
          <div className="caption-dialog-toolbar">
            <span>{captions.length} 条字幕</span>
            <button className="text-button" disabled={busy} onClick={() => setEditing(!editing)}>
              <Icon name="edit" size={14} />{editing ? "结束编辑" : "校对字幕"}
            </button>
          </div>
        <div className="caption-panel" role="region" aria-label="字幕内容">
          <div className="caption-info">
            <span>按每段实际音频长度生成 · 点击时间可跳转</span>
            <button
              className="text-button"
              onClick={() => onCopy(captions.map((c) => c.text).join("\n"))}
            >
              <Icon name="copy" size={14} />
              复制文本
            </button>
          </div>
          {editing && (
            <p className="caption-edit-hint">
              修改字幕不会改变配音。若需要更改朗读内容，请修改文稿并重新生成。
            </p>
          )}
          <div className="caption-list">
            {captions.map((caption, index) => (
              <div
                className={`caption-row${time >= caption.start && time < caption.end ? " current" : ""}`}
                key={index}
              >
                <span className="caption-number">{index + 1}</span>
                <button
                  className="caption-time"
                  aria-label={`跳转到第 ${index + 1} 条字幕`}
                  onClick={() =>
                    setSeek({ time: caption.start, id: Date.now() })
                  }
                >
                  {formatDuration(caption.start)}
                </button>
                {editing ? (
                  <textarea
                    aria-label={`第 ${index + 1} 条字幕内容`}
                    value={caption.text}
                    disabled={busy}
                    maxLength={2000}
                    rows={2}
                    onChange={(e) =>
                      setCaptions((previous) =>
                        previous.map((item, i) =>
                          i === index
                            ? { ...item, text: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                ) : (
                  <p>{caption.text}</p>
                )}
              </div>
            ))}
          </div>
          {dirty && (
            <div className="caption-save">
              <span>有未保存的字幕修改</span>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setCaptions(bundle.captions)}
              >
                还原
              </button>
              <button
                className="button secondary"
                disabled={busy || !valid}
                onClick={() => void onSaveCaptions(bundle, captions)}
              >
                保存字幕
              </button>
            </div>
          )}
        </div>
        </div>
      </Modal>}
    </>
  );
}
