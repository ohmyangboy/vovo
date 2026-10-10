import { useEffect, useState } from "react";
import { formatDuration } from "../domain";
import type { Bundle, Caption } from "../types";
import { AudioPlayer } from "./AudioPlayer";
import { Icon } from "./Icon";

export function ResultPanel({
  bundle,
  outdated = false,
  busy,
  onExport,
  onSaveCaptions,
  onCopy,
  onReveal,
}: {
  bundle: Bundle;
  outdated?: boolean;
  busy: boolean;
  onExport: (bundle: Bundle) => void;
  onSaveCaptions: (bundle: Bundle, captions: Caption[]) => Promise<void>;
  onCopy: (text: string) => void;
  onReveal: (path: string) => void;
}) {
  const [tab, setTab] = useState<"audio" | "captions">("audio");
  const [time, setTime] = useState(0);
  const [captions, setCaptions] = useState(bundle.captions);
  const [editing, setEditing] = useState(false);
  const [seek, setSeek] = useState<{ time: number; id: number }>();
  useEffect(() => {
    setCaptions(bundle.captions);
    setEditing(false);
    setTime(0);
  }, [bundle.id, bundle.captionRevision, bundle.captions]);
  const dirty = captions.some(
    (caption, index) => caption.text !== bundle.captions[index]?.text,
  );
  const valid = captions.every((caption) => caption.text.trim());
  return (
    <section className="result-panel" aria-label="生成结果">
      <header className="result-header">
        <div className="result-heading">
          <span className="result-check">
            <Icon name="check" size={17} />
          </span>
          <div>
            <h2>{bundle.title}</h2>
            <p>
              {bundle.voiceName} <span>·</span>{" "}
              {formatDuration(bundle.duration)} <span>·</span>{" "}
              {bundle.sampleRate / 1000} kHz
            </p>
          </div>
        </div>
        <button
          className="button secondary"
          disabled={busy || dirty}
          onClick={() => onExport(bundle)}
        >
          <Icon name="download" size={16} />
          导出文件
        </button>
      </header>
      {outdated && (
        <p className="result-notice">
          文稿或声音已经修改。这是之前的生成版本，重新生成后才会更新配音。
        </p>
      )}
      <AudioPlayer
        key={bundle.id}
        path={bundle.wav}
        duration={bundle.duration}
        onTimeChange={setTime}
        seekRequest={seek}
      />
      <div className="result-tabs">
        <div className="tabs" role="tablist" aria-label="结果视图">
          <button
            role="tab"
            aria-selected={tab === "audio"}
            className={tab === "audio" ? "active" : ""}
            onClick={() => setTab("audio")}
          >
            音频文件
          </button>
          <button
            role="tab"
            aria-selected={tab === "captions"}
            className={tab === "captions" ? "active" : ""}
            onClick={() => setTab("captions")}
          >
            字幕 <span className="count">{captions.length}</span>
          </button>
        </div>
        {tab === "captions" && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            <Icon name="edit" size={14} />
            {editing ? "结束编辑" : "校对字幕"}
          </button>
        )}
      </div>
      {tab === "audio" ? (
        <div className="artifact-list" role="tabpanel">
          <div>
            <span className="artifact-icon">
              <Icon name="wave" size={18} />
            </span>
            <div>
              <strong>配音已保存</strong>
              <p>原始 WAV 与 MP3 · 可随时从生成记录再次导出</p>
            </div>
            <button
              className="icon-button"
              title="在文件夹中显示"
              aria-label="在文件夹中显示音频"
              onClick={() => onReveal(bundle.wav)}
            >
              <Icon name="folder" size={18} />
            </button>
          </div>
          <div>
            <span className="artifact-icon">
              <Icon name="file" size={18} />
            </span>
            <div>
              <strong>字幕与文稿</strong>
              <p>SRT 句级字幕与 TXT 文稿 · 建议试听核对</p>
            </div>
            <button className="text-button" onClick={() => setTab("captions")}>
              查看字幕 <Icon name="chevron" size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div className="caption-panel" role="tabpanel">
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
      )}
    </section>
  );
}
