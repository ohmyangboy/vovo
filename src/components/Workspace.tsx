import { useRef, useState, type ReactNode } from "react";
import { modelNames } from "../catalog";
import { characterCount, estimatedDuration } from "../domain";
import type { ActiveJob, Draft, ModelId, VoiceChoice } from "../types";
import { Icon } from "./Icon";
import { JobProgress } from "./JobProgress";

export function Workspace({
  draft,
  onDraft,
  voice,
  onChooseVoice,
  onChooseModel,
  onClone,
  onImport,
  onBrowserFile,
  onClear,
  onGenerate,
  onPreview,
  onExample,
  job,
  onCancel,
  dragging,
  saved,
  children,
}: {
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  voice?: VoiceChoice;
  onChooseVoice: () => void;
  onChooseModel: (model: ModelId) => void;
  onClone: () => void;
  onImport: () => void;
  onBrowserFile: (file: File) => void;
  onClear: () => void;
  onGenerate: () => void;
  onPreview: (text: string) => void;
  onExample: () => void;
  job: ActiveJob | null;
  onCancel: () => void;
  dragging: boolean;
  saved: boolean;
  children?: ReactNode;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const [modelExpanded, setModelExpanded] = useState(false);
  const count = characterCount(draft.text);
  const limit = voice?.model === "clone" ? 2000 : 10000;
  const hasText = !!draft.text.trim();
  function insertPause() {
    const element = editor.current;
    const start = element?.selectionStart ?? draft.text.length;
    const end = element?.selectionEnd ?? start;
    const token = "【停顿:1秒】";
    onDraft({
      text: draft.text.slice(0, start) + token + draft.text.slice(end),
    });
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(
        start + token.length,
        start + token.length,
      );
    });
  }
  function previewSelection() {
    const element = editor.current;
    const text =
      element && element.selectionStart !== element.selectionEnd
        ? draft.text.slice(element.selectionStart, element.selectionEnd)
        : draft.text.trim().slice(0, 90);
    onPreview(text);
  }
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">让文字被听见 · VOICE STUDIO</span>
          <h1>生成工作台</h1>
          <p>选一个喜欢的声音，把文稿变成配音与字幕。</p>
        </div>
        <span className="privacy-note">
          <Icon name="shield" size={15} />
          本地处理，内容不上传
        </span>
      </header>
      <div className={`workspace-surface${dragging ? " dragging" : ""}`}>
        <div className="creation-grid">
          <div className="script-section">
            <div className="panel-heading">
              <span>
                <Icon name="file" size={16} /> 文稿编辑
              </span>
              <span className="panel-step">01</span>
            </div>
            <div className="script-toolbar">
              <input
                className="script-title"
                aria-label="文稿标题"
                value={draft.title}
                maxLength={100}
                placeholder="未命名文稿"
                onChange={(e) => onDraft({ title: e.target.value })}
              />
              <span className="save-indicator">
                {saved ? (
                  <Icon name="check" size={13} />
                ) : (
                  <span className="saved-dot" />
                )}
                {saved ? "已自动保存" : "保存中…"}
              </span>
            </div>
            <div className="editor-tools">
              <button className="text-button" onClick={onImport}>
                <Icon name="upload" size={15} />
                导入文稿
              </button>
              <button className="text-button" onClick={insertPause}>
                <Icon name="pause" size={14} />
                插入停顿
              </button>
              <span className="spacer" />
              {hasText && (
                <button
                  className="icon-button"
                  title="清空文稿"
                  aria-label="清空文稿"
                  onClick={onClear}
                >
                  <Icon name="trash" size={15} />
                </button>
              )}
            </div>
            <div
              className={`editor-container${hasText ? "" : " is-empty"}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) onBrowserFile(file);
              }}
            >
              <textarea
                ref={editor}
                className="script-editor"
                aria-label="配音文稿"
                value={draft.text}
                onChange={(e) => onDraft({ text: e.target.value })}
                placeholder={
                  "在这里输入或粘贴文稿……\n\n也可以拖入 TXT、Markdown 或 DOCX 文件。"
                }
                spellCheck={false}
              />
              {!hasText && (
                <ScriptEmptyState
                  onExample={() =>
                    onDraft({
                      title: "一段关于声音的文稿",
                      text: "有些文字，值得被听见。\n\n清晨的一杯咖啡，午后的一缕阳光，还有那些想要分享的故事。选择一个喜欢的声音，让它们从纸面走进耳朵。",
                    })
                  }
                />
              )}
              {dragging && (
                <div className="drop-overlay">
                  <Icon name="upload" size={30} />
                  <strong>松开以导入文稿</strong>
                </div>
              )}
            </div>
          </div>
          <aside className="generation-options" aria-label="本次配音选项">
            <div className="panel-heading options-heading">
              <span>
                <Icon name="wave" size={16} /> 配音设置
              </span>
              <span className="panel-step">02</span>
            </div>
            <label className="section-label">声音</label>
            <button className="selected-voice-button" onClick={onChooseVoice}>
              <span className="voice-avatar">
                <Icon
                  name={voice?.kind === "cloned" ? "mic" : "wave"}
                  size={22}
                />
              </span>
              <span>
                <strong>{voice?.name ?? "选择一个声音"}</strong>
                <small>{voice?.group ?? "预设音色或我的声音"}</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
            <button
              className="text-button voice-example"
              disabled={!!job || !voice}
              onClick={onExample}
            >
              <Icon name="play" size={14} />
              听声音示例
            </button>
            {voice?.model !== "clone" ? (
              <div className="speed-setting">
                <div>
                  <label htmlFor="generation-speed">语速</label>
                  <output htmlFor="generation-speed">
                    {draft.speed.toFixed(2)}×
                  </output>
                </div>
                <p className="speed-description">找到适合这段故事的节奏</p>
                <input
                  id="generation-speed"
                  type="range"
                  min={0.8}
                  max={1.3}
                  step={0.05}
                  value={draft.speed}
                  onChange={(e) => onDraft({ speed: Number(e.target.value) })}
                />
                <div className="range-labels">
                  <span>舒缓</span>
                  <button
                    className="text-button"
                    onClick={() => onDraft({ speed: 1 })}
                  >
                    标准
                  </button>
                  <span>轻快</span>
                </div>
              </div>
            ) : (
              <p className="option-hint">
                使用参考录音中的自然语速。播放时可以单独调整倍速。
              </p>
            )}
            <div className="options-divider" />
            <button
              className="clone-shortcut"
              disabled={!!job}
              onClick={onClone}
            >
              <Icon name="plus" size={16} />
              使用自己的声音
            </button>
            <div className="model-summary">
              <button
                className="text-button"
                aria-expanded={modelExpanded}
                onClick={() => setModelExpanded(!modelExpanded)}
              >
                <span className="local-dot" />
                本地生成 · {voice ? modelNames[voice.model] : "自动推荐"}
                <Icon name="down" size={13} />
              </button>
              {modelExpanded && (
                <div className="model-inline">
                  <label htmlFor="workspace-model">本次配音方式</label>
                  <select
                    id="workspace-model"
                    value={voice?.model ?? "zh"}
                    onChange={(e) => onChooseModel(e.target.value as ModelId)}
                  >
                    <option value="zh">中文与中英混读</option>
                    <option value="en">英文配音</option>
                    <option value="clone">我的声音</option>
                  </select>
                  <p>切换后选择一个声音。所需功能可在设置里一键准备。</p>
                </div>
              )}
            </div>
          </aside>
        </div>
        <footer className="generate-toolbar">
          <div className={`script-stats${count > limit ? " invalid" : ""}`}>
            <span>
              {count.toLocaleString()} / {limit.toLocaleString()} 字
            </span>
            {hasText && (
              <>
                <span className="stat-dot">·</span>
                <span>
                  {estimatedDuration(
                    draft.text,
                    voice?.model === "clone" ? 1 : draft.speed,
                  )}
                </span>
              </>
            )}
          </div>
          <div className="generate-actions">
            <button
              className="button secondary"
              disabled={!hasText || !!job || !voice || count > limit}
              onClick={previewSelection}
            >
              <Icon name="play" size={16} />
              试听文稿
            </button>
            <button
              className="button primary"
              disabled={!hasText || !!job || !voice || count > limit}
              onClick={onGenerate}
            >
              {job?.kind === "generate" ? (
                <span className="spinner" />
              ) : (
                <Icon name="wave" size={18} />
              )}
              生成配音
            </button>
          </div>
        </footer>
        {job && ["generate", "preview"].includes(job.kind) && (
          <JobProgress job={job} onCancel={onCancel} />
        )}
      </div>
      <div className="workspace-footnote">
        <span>
          <Icon name="file" size={13} /> 支持 TXT、Markdown 与 DOCX 文稿
        </span>
        <span>
          <kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd> 生成配音
        </span>
      </div>
      {children}
    </section>
  );
}

function ScriptEmptyState({ onExample }: { onExample: () => void }) {
  return (
    <div className="editor-empty-state">
      <div className="empty-wave" aria-hidden="true">
        {[10, 18, 30, 21, 40, 57, 36, 65, 46, 28, 48, 34, 22, 32, 18, 12, 6].map(
          (height, index) => <span key={index} style={{ height }} />,
        )}
      </div>
      <h2>从一段文字开始</h2>
      <p>
        写下灵感，或把准备好的文稿拖到这里。
        <br />
        让每一个故事，都有自己的声音。
      </p>
      <button className="button secondary" onClick={onExample}>
        试试示例文稿 <Icon name="chevron" size={14} />
      </button>
    </div>
  );
}
