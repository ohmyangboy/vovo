export function GenerateCard({
  generating,
  progress,
  status,
  canGenerate,
  onGenerate,
  lastMP3,
  lastSRT,
  onReveal,
  onOpenSRT,
}: {
  generating: boolean;
  progress: { done: number; total: number };
  status: string;
  canGenerate: boolean;
  onGenerate: () => void;
  lastMP3: string;
  lastSRT: string;
  onReveal: () => void;
  onOpenSRT: () => void;
}) {
  const ready = progress.total > 1;
  const pct = ready ? (progress.done / progress.total) * 100 : 0;

  return (
    <section className="card">
      <h2 className="card-title">③ 生成</h2>
      <div className="row">
        <button className="btn primary" disabled={!canGenerate || generating} onClick={onGenerate}>
          {generating ? "生成中…" : "生成配音 + 字幕"}
        </button>
        {generating && (
          <>
            <div className={`progress-track${ready ? "" : " indeterminate"}`}>
              <div className="progress-fill" style={ready ? { width: `${pct}%` } : undefined} />
            </div>
            <span className="progress-text">
              {ready ? `${progress.done}/${progress.total} 句` : "准备中…"}
            </span>
          </>
        )}
      </div>

      {status && <p className="status-line">{status}</p>}

      {(lastMP3 || lastSRT) && (
        <div className="result-row">
          <button className="btn small" onClick={onReveal}>
            打开所在文件夹
          </button>
          {lastSRT && (
            <button className="btn small" onClick={onOpenSRT}>
              查看字幕文件
            </button>
          )}
        </div>
      )}
    </section>
  );
}
