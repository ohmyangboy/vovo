export function TextInputSheet({
  draft,
  setDraft,
  onApply,
  onClose,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>输入或粘贴文本</h2>
        <p className="hint">每个自然段之间用空行分隔；生成时会自动按句切分并制作字幕。</p>
        <textarea
          autoFocus
          value={draft}
          placeholder="在这里输入或粘贴文稿内容 ..."
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="row">
          <span className="hint hint-3">{draft.length} 字符</span>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!draft.trim()} onClick={onApply}>
            使用此文本
          </button>
        </div>
      </div>
    </div>
  );
}
