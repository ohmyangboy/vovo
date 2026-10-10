import { useMemo, useState, type ReactNode } from "react";
import type { Bundle } from "../types";
import { formatDuration } from "../domain";
import { Icon } from "./Icon";

export function HistoryPage({
  records,
  selected,
  busy,
  onOpen,
  onUse,
  onDelete,
  onBack,
  onWorkspace,
  renderResult,
}: {
  records: Bundle[];
  selected?: Bundle;
  busy: boolean;
  onOpen: (record: Bundle) => void;
  onUse: (record: Bundle) => void;
  onDelete: (record: Bundle) => void;
  onBack: () => void;
  onWorkspace: () => void;
  renderResult: (record: Bundle) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      records.filter((record) =>
        `${record.title} ${record.voiceName} ${record.text}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      ),
    [records, query],
  );
  return (
    <section className="history-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">每一次创作，都有迹可循</span>
          <h1>生成记录</h1>
          <p>试听旧版本、复用文稿，或者再次导出。</p>
        </div>
        {selected && (
          <button className="button secondary" onClick={onBack}>
            <Icon name="back" size={15} />
            返回记录
          </button>
        )}
      </header>
      {selected ? (
        <>
          <div className="history-detail-actions">
            <span>{new Date(selected.createdAt).toLocaleString("zh-CN")}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => onUse(selected)}
            >
              使用这份文稿和声音 <Icon name="chevron" size={14} />
            </button>
          </div>
          {renderResult(selected)}
        </>
      ) : (
        <>
          <label className="search-field history-search">
            <Icon name="search" size={17} />
            <input
              aria-label="搜索生成记录"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、声音或文稿内容"
            />
          </label>
          {filtered.length ? (
            <div className="history-list">
              {filtered.map((record) => (
                <article className="history-item" key={record.id}>
                  <button
                    className="history-main"
                    onClick={() => onOpen(record)}
                  >
                    <span className="history-art">
                      <Icon name="wave" size={24} />
                    </span>
                    <span className="history-copy">
                      <strong>{record.title}</strong>
                      <span>
                        {record.voiceName} <span>·</span>{" "}
                        {formatDuration(record.duration)} <span>·</span>{" "}
                        {record.captions.length} 条字幕
                      </span>
                      <small>{record.text.slice(0, 100)}</small>
                    </span>
                    <span className="history-date">
                      {new Date(record.createdAt).toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Icon name="chevron" size={16} />
                  </button>
                  <div className="history-item-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => onUse(record)}
                    >
                      <Icon name="copy" size={14} />
                      复用文稿
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`删除记录 ${record.title}`}
                      disabled={busy}
                      onClick={() => onDelete(record)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state large">
              <span className="empty-icon">
                <Icon name="clock" size={32} />
              </span>
              <h3>{query ? "没有匹配的记录" : "第一段配音，从这里开始"}</h3>
              <p>
                {query
                  ? "试试其他标题、声音或关键词。"
                  : "完成的音频与字幕会自动保留在本机，随时回来试听和导出。"}
              </p>
              {!query && (
                <button className="button secondary" onClick={onWorkspace}>
                  前往工作台 <Icon name="chevron" size={15} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
