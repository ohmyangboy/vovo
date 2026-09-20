import { useEffect, useRef } from "react";

export function InstallCard({
  installing,
  installed,
  onInstall,
}: {
  installing: boolean;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <section className="card fade-in">
      <h2 className="card-title">{installed ? "引擎需要修复" : "首次使用：安装本地引擎"}</h2>
      <p className="hint">
        引擎包含语音合成所需的运行环境（约 200MB），完全安装在本机，文稿不会上传到任何服务器。
        已有的 Python / uv 会被自动复用。
      </p>
      <div className="row">
        <button className="btn primary" disabled={installing} onClick={onInstall}>
          {installing ? "安装中 ..." : "安装引擎"}
        </button>
        {installing && <span className="spinner" />}
      </div>
    </section>
  );
}

export function LogPanel({ log, onHide }: { log: string[]; onHide: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length]);

  return (
    <section className="card fade-in">
      <div className="row">
        <h2 className="card-title">任务日志</h2>
        <div className="spacer" />
        <button className="btn ghost small" onClick={onHide}>
          隐藏
        </button>
      </div>
      <div className="log-panel" ref={ref}>
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}
