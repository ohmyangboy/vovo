export function DocumentCard({
  docTitle,
  paragraphs,
  dragging,
  disabled,
  onPickFile,
  onOpenTextInput,
  onClear,
}: {
  docTitle: string;
  paragraphs: string[];
  dragging: boolean;
  disabled: boolean;
  onPickFile: () => void;
  onOpenTextInput: () => void;
  onClear: () => void;
}) {
  const hasDoc = paragraphs.length > 0;

  return (
    <section className="card">
      <h2 className="card-title">① 文稿</h2>
      <div className="row">
        <button className="btn" disabled={disabled} onClick={onPickFile}>
          导入文稿
        </button>
        <button className="btn" disabled={disabled} onClick={onOpenTextInput}>
          直接输入文本
        </button>
        {hasDoc ? (
          <>
            <span className="doc-meta" title={docTitle}>
              {docTitle} · {paragraphs.length} 段
            </span>
            <div className="spacer" />
            <button className="btn ghost small" onClick={onClear}>
              清除
            </button>
          </>
        ) : (
          <span className="hint hint-3">支持 txt / md / docx，或点击「直接输入文本」</span>
        )}
      </div>

      {hasDoc ? (
        <div className="doc-preview">
          {paragraphs.slice(0, 3).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {paragraphs.length > 3 && (
            <p className="hint-3">…… 共 {paragraphs.length} 段</p>
          )}
        </div>
      ) : (
        <div className={`drop-hint${dragging ? " dragging" : ""}`}>
          {dragging ? "松开以导入文稿" : "或将 txt / md / docx 文稿拖到这里"}
        </div>
      )}
    </section>
  );
}
