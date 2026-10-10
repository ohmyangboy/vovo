import { useEffect, useRef } from "react";
import { formatDuration } from "../domain";
import type { Bundle } from "../types";

export function SidebarHistory({ records, selected, onOpen }: {
  records: Bundle[];
  selected?: string;
  onOpen: (record: Bundle) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const newest = records[0]?.id;
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [newest]);

  return (
    <section className="sidebar-history" aria-label="生成记录">
      <div className="sidebar-history-heading">
        <span>生成记录</span>
        {records.length > 0 && <span>{records.length}</span>}
      </div>
      <div className="sidebar-history-list" ref={list}>
        {records.map((record) => (
          <button
            className={`sidebar-record${selected === record.id ? " active" : ""}`}
            key={record.id}
            aria-label={`打开记录 ${record.title}`}
            aria-current={selected === record.id ? "page" : undefined}
            title={`${record.title}\n${record.voiceName} · ${new Date(record.createdAt).toLocaleString("zh-CN")}`}
            onClick={() => onOpen(record)}
          >
            <strong>{record.title}</strong>
            <span className="sidebar-record-meta">
              <span>{record.voiceName}</span>
              <span>{formatDuration(record.duration)}</span>
            </span>
          </button>
        ))}
        {records.length === 0 && <p className="sidebar-history-empty">完成的配音会保存在这里</p>}
      </div>
    </section>
  );
}
