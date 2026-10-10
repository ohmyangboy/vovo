import { useMemo, useState } from "react";
import type { ActiveJob, ModelId, VoiceChoice } from "../types";
import { Icon } from "./Icon";

export interface VoiceBrowserProps {
  voices: VoiceChoice[];
  selected: string;
  favorites: string[];
  recent?: string[];
  busy: boolean;
  previewing?: string;
  preparation?: ActiveJob;
  onPrepare: () => void;
  initialModel?: ModelId;
  onChoose: (voice: VoiceChoice) => void;
  onPreview: (voice: VoiceChoice) => void;
  onFavorite: (key: string) => void;
  onClone: () => void;
  onDelete?: (voice: VoiceChoice) => void;
  onRename?: (voice: VoiceChoice) => void;
}
export function VoiceBrowser({
  voices,
  selected,
  favorites,
  recent = [],
  busy,
  previewing,
  preparation,
  onPrepare,
  initialModel,
  onChoose,
  onPreview,
  onFavorite,
  onClone,
  onDelete,
  onRename,
}: VoiceBrowserProps) {
  const [tab, setTab] = useState<"all" | "mine" | "favorites" | "recent">(
    initialModel === "clone" ? "mine" : "all",
  );
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [model, setModel] = useState(initialModel ?? "all");
  const filtered = useMemo(
    () =>
      voices
        .filter((v) => {
          if (tab === "mine" && v.kind !== "cloned") return false;
          if (tab === "favorites" && !favorites.includes(v.key)) return false;
          if (tab === "recent" && !recent.includes(v.key)) return false;
          if (language !== "all" && v.language !== language) return false;
          if (model !== "all" && v.model !== model) return false;
          return `${v.name} ${v.group} ${v.description} ${v.id}`
            .toLowerCase()
            .includes(query.trim().toLowerCase());
        })
        .sort((a, b) =>
          tab === "recent" ? recent.indexOf(a.key) - recent.indexOf(b.key) : 0,
        ),
    [voices, tab, favorites, recent, language, model, query],
  );
  return (
    <div className="voice-browser">
      <div className="browser-top">
        <div className="tabs" role="tablist" aria-label="声音分类">
          {(
            [
              ["all", "全部声音"],
              ["mine", "我的声音"],
              ["favorites", "收藏"],
              ["recent", "最近使用"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {label}
              {value === "mine" && voices.some((v) => v.kind === "cloned") && (
                <span className="count">
                  {voices.filter((v) => v.kind === "cloned").length}
                </span>
              )}
            </button>
          ))}
        </div>
        <button className="button secondary" disabled={busy} onClick={onClone}>
          <Icon name="plus" size={16} />
          克隆声音
        </button>
      </div>
      {voices.some((voice) => !voice.previewAudio) && (
        <div className="voice-preparation-notice">
          <Icon name={preparation ? "wave" : "download"} size={18} />
          <div>
            <strong>{preparation ? "声音正在准备，已完成的可以先听" : "一次准备，所有声音随时试听"}</strong>
            <span>{preparation
              ? "完成的声音会自动标记为可播放，中途暂停也会保留。"
              : "提前准备好声音与试听，之后点击播放即可。"}</span>
          </div>
          <button className="button secondary small" disabled={busy && !preparation} onClick={onPrepare}>
            {preparation ? "查看进度" : "一键准备全部"}
          </button>
        </div>
      )}
      <div className="voice-filters">
        <label className="search-field">
          <Icon name="search" size={17} />
          <input
            aria-label="搜索声音"
            placeholder="搜索名称、语言或声音特点"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="筛选声音语言"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="all">所有语言</option>
          <option value="zh">中文</option>
          <option value="en">英文</option>
        </select>
        <select
          aria-label="筛选生成方式"
          value={model}
          onChange={(e) => setModel(e.target.value as ModelId | "all")}
        >
          <option value="all">所有配音方式</option>
          <option value="zh">中文配音</option>
          <option value="en">英文配音</option>
          <option value="clone">声音克隆</option>
        </select>
      </div>
      <div className="browser-meta">
        <span>{filtered.length} 个声音</span>
        <span>先听一听，再选择适合文稿的声音</span>
      </div>
      {filtered.length ? (
        <div className="voice-grid" role="tabpanel">
          {filtered.map((voice) => {
            const playable = !!voice.previewAudio;
            const preparing = !playable && (preparation?.voiceKey === voice.key || previewing === voice.key);
            const pending = !playable && !!preparation;
            return (
            <article
              className={`voice-tile${selected === voice.key ? " selected" : ""}`}
              key={voice.key}
            >
              <button
                className="voice-select"
                aria-label={`选择声音 ${voice.name}`}
                aria-pressed={selected === voice.key}
                onClick={() => onChoose(voice)}
              >
                <span className={`voice-avatar ${voice.kind}`}>
                  <Icon
                    name={voice.kind === "cloned" ? "mic" : "wave"}
                    size={21}
                  />
                </span>
                <span className="voice-copy">
                  <strong>{voice.name}</strong>
                  <span>{voice.group}</span>
                  {voice.description && <small>{voice.description}</small>}
                </span>
                {selected === voice.key && (
                  <span className="selected-check">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
              <div className="voice-tile-footer">
                <span className={`voice-sample-status${playable ? " ready" : preparing ? " preparing" : ""}`}>
                  {playable ? <Icon name="check" size={14} /> : preparing ? <span className="spinner" /> : null}
                  {playable ? "可播放" : preparing ? "准备中" : pending ? "等待准备" : voice.kind === "cloned" ? "待试听" : "待准备"}
                </span>
                <div className="inline-actions">
                  <button
                    className="icon-button"
                    title={playable ? "播放已准备好的声音示例" : voice.kind === "preset" ? "请先一键准备声音试听" : "试听声音示例"}
                    aria-label={`试听 ${voice.name}`}
                    disabled={preparing || (!playable && (busy || voice.kind === "preset"))}
                    onClick={() => onPreview(voice)}
                  >
                    {previewing === voice.key ? (
                      <span className="spinner" />
                    ) : (
                      <Icon name="play" size={16} />
                    )}
                  </button>
                  <button
                    className={`icon-button${favorites.includes(voice.key) ? " favorited" : ""}`}
                    aria-label={`${favorites.includes(voice.key) ? "取消收藏" : "收藏"} ${voice.name}`}
                    aria-pressed={favorites.includes(voice.key)}
                    onClick={() => onFavorite(voice.key)}
                  >
                    <Icon
                      name="star"
                      size={17}
                      filled={favorites.includes(voice.key)}
                    />
                  </button>
                  {voice.kind === "cloned" && onRename && (
                    <button
                      className="icon-button"
                      aria-label={`重命名 ${voice.name}`}
                      disabled={busy}
                      onClick={() => onRename(voice)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  {voice.kind === "cloned" && onDelete && (
                    <button
                      className="icon-button"
                      aria-label={`删除声音 ${voice.name}`}
                      disabled={busy}
                      onClick={() => onDelete(voice)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          );})}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name={tab === "favorites" ? "star" : "voices"} size={28} />
          </span>
          <h3>
            {tab === "mine"
              ? "还没有你的声音"
              : tab === "favorites"
                ? "收藏喜欢的声音"
                : tab === "recent"
                  ? "还没有最近使用的声音"
                  : "没有找到匹配的声音"}
          </h3>
          <p>
            {tab === "mine"
              ? "用一段干净的参考录音，创建可反复使用的私有声音。"
              : "尝试调整筛选，或点击声音旁的星标收藏。"}
          </p>
          {tab === "mine" && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={onClone}
            >
              <Icon name="plus" size={16} />
              创建我的声音
            </button>
          )}
        </div>
      )}
    </div>
  );
}
