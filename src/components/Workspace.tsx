import { useRef, type ReactNode } from "react";
import type { ActiveJob, Draft, VoiceChoice } from "../types";
import { Icon } from "./Icon";
import { ControlMenu } from "./ControlMenu";

export function Workspace({ draft, onDraft, voice, onChooseVoice, onImport, onBrowserFile,
  onClear, onPreview, job, dragging, saved, renderFooter,
}: {
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  voice?: VoiceChoice;
  onChooseVoice: () => void;
  onImport: () => void;
  onBrowserFile: (file: File) => void;
  onClear: () => void;
  onPreview: (text: string) => void;
  job: ActiveJob | null;
  dragging: boolean;
  saved: boolean;
  renderFooter: (onPreview: () => void) => ReactNode;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const hasText = !!draft.text.trim();
  function closeMenu(element: HTMLElement) { element.closest("details")?.removeAttribute("open"); }
  function insertPause() {
    const start = editor.current?.selectionStart ?? draft.text.length;
    const end = editor.current?.selectionEnd ?? start;
    const token = "【停顿:1秒】";
    onDraft({ text: draft.text.slice(0, start) + token + draft.text.slice(end) });
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  function previewSelection() {
    const element = editor.current;
    onPreview(element && element.selectionStart !== element.selectionEnd
      ? draft.text.slice(element.selectionStart, element.selectionEnd) : draft.text.trim());
  }
  return (
    <section className="workspace-page focused-workspace single-page-studio">
      <div className="studio-body">
        <div className={"workspace-surface" + (dragging ? " dragging" : "")}>
          <div className="compose-controls" aria-label="配音选项">
            <button className="compose-voice" aria-label={"选择声音 " + (voice?.name ?? "")} onClick={onChooseVoice}>
              <span className="voice-avatar"><Icon name={voice?.kind === "cloned" ? "mic" : "wave"} size={18} /></span>
              <strong>{voice?.name ?? "选择声音"}</strong><span className="compose-voice-group">{voice?.group}</span><Icon name="down" size={13} />
            </button>
            <span className="spacer" />
            <ControlMenu className="speed-menu" label="调整语速" trigger={<>语速 <strong>{draft.speed.toFixed(2)}×</strong><Icon name="down" size={13} /></>}>
              <div className="control-popover">
                <label htmlFor="generation-speed">配音语速</label>
                <input id="generation-speed" type="range" min={0.8} max={1.3} step={0.05} value={draft.speed}
                  disabled={!!job} onChange={(e) => onDraft({ speed: Number(e.target.value) })} />
                <div className="range-labels"><span>舒缓</span><button className="text-button" disabled={!!job} onClick={() => onDraft({ speed: 1 })}>恢复标准</button><span>轻快</span></div>
                <p className="help-text">会应用到生成和导出的音频</p>
              </div>
            </ControlMenu>
            <ControlMenu className="editor-menu" label="更多文稿操作" trigger={<Icon name="more" size={18} />}>
              <div className="control-popover menu-actions">
                <button onClick={(e) => { closeMenu(e.currentTarget); onImport(); }}><Icon name="upload" size={15} />导入文稿</button>
                <button onClick={(e) => { closeMenu(e.currentTarget); insertPause(); }}><Icon name="pause" size={15} />插入停顿</button>
                <button disabled={!hasText} onClick={(e) => { closeMenu(e.currentTarget); onClear(); }}><Icon name="trash" size={15} />清空文稿</button>
              </div>
            </ControlMenu>
          </div>
          <div className="script-toolbar">
            <input className="script-title" aria-label="文稿标题" value={draft.title} maxLength={100}
              placeholder="未命名文稿" onChange={(e) => onDraft({ title: e.target.value })} />
            <span className="save-indicator" title={saved ? "文稿已自动保存在本机" : "正在保存"}>
              {saved ? <Icon name="check" size={13} /> : <span className="saved-dot" />}{saved ? "已保存" : "保存中…"}
            </span>
          </div>
          <div className={"editor-container" + (hasText ? "" : " is-empty")}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) onBrowserFile(file); }}>
            <textarea ref={editor} className="script-editor" aria-label="配音文稿" value={draft.text}
              onChange={(e) => onDraft({ text: e.target.value })} spellCheck={false}
              placeholder="输入或粘贴文稿，也可以拖入 TXT、Markdown 或 DOCX 文件。" />
            {!hasText && <ScriptEmptyState onExample={() => onDraft({ title: "一段关于声音的文稿", text: "有些文字，值得被听见。\n\n清晨的一杯咖啡，午后的一缕阳光，还有那些想要分享的故事。选择一个喜欢的声音，让它们从纸面走进耳朵。" })} />}
            {dragging && <div className="drop-overlay"><Icon name="upload" size={30} /><strong>松开以导入文稿</strong></div>}
          </div>
        </div>
      </div>
      {renderFooter(previewSelection)}
    </section>
  );
}
function ScriptEmptyState({ onExample }: { onExample: () => void }) {
  return <div className="editor-empty-state">
    <div className="empty-wave" aria-hidden="true">{[10, 18, 30, 21, 40, 57, 36, 65, 46, 28, 48, 34, 22, 32, 18, 12, 6].map((height, index) => <span key={index} style={{ height }} />)}</div>
    <h2>从一段文字开始</h2><p>输入文稿，选个声音，就能听见。</p>
    <button className="button secondary" onClick={onExample}>试试示例文稿<Icon name="chevron" size={14} /></button>
  </div>;
}
