import type { ReactNode } from "react";
import type { Bundle } from "../types";
import { Icon } from "./Icon";

export function HistoryPage({ selected, busy, onUse, onDelete, renderResult }: {
  selected: Bundle;
  busy: boolean;
  onUse: (record: Bundle) => void;
  onDelete: (record: Bundle) => void;
  renderResult: (record: Bundle) => ReactNode;
}) {
  return (
    <section className="history-page single-page-studio">
      <div className="studio-body history-body">
      <header className="page-heading history-heading">
        <h2>{selected.title}</h2>
        <div className="history-detail-actions">
          <button className="button secondary" disabled={busy} onClick={() => onUse(selected)}>
            <Icon name="edit" size={15} />继续编辑
          </button>
          <button className="icon-button" aria-label={`删除记录 ${selected.title}`}
            disabled={busy} onClick={() => onDelete(selected)}>
            <Icon name="trash" size={17} />
          </button>
        </div>
      </header>
      <p className="history-created">{new Date(selected.createdAt).toLocaleString("zh-CN")} 生成</p>
      <div className="history-source" role="region" aria-label="原始文稿">
        <p>{selected.text}</p>
      </div>
      </div>
      {renderResult(selected)}
    </section>
  );
}
