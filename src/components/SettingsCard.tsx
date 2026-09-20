import type { ModelInfo, VoiceInfo } from "../types";

export function SettingsCard({
  models,
  selectedModel,
  selectedVoice,
  voices,
  speed,
  outputDir,
  previewing,
  busy,
  disabled,
  onModelChange,
  onVoiceChange,
  onSpeedChange,
  onPreview,
  onPickOutput,
  onDownload,
  onDelete,
}: {
  models: ModelInfo[];
  selectedModel: string;
  selectedVoice: string;
  voices: VoiceInfo[];
  speed: number;
  outputDir: string;
  previewing: boolean;
  busy: boolean;
  disabled: boolean;
  onModelChange: (id: string) => void;
  onVoiceChange: (id: string) => void;
  onSpeedChange: (v: number) => void;
  onPreview: () => void;
  onPickOutput: () => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="card">
      <h2 className="card-title">② 配音设置</h2>
      <div className="settings-grid">
        <div className="setting-row">
          <span className="field-label">模型</span>
          <select
            value={selectedModel}
            disabled={disabled || models.length === 0}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.installed ? m.name : `${m.name}（未下载）`}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <span className="field-label">音色</span>
          <select
            value={selectedVoice}
            disabled={disabled || voices.length === 0}
            onChange={(e) => onVoiceChange(e.target.value)}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.group} · {v.id}
                {v.label ? ` — ${v.label}` : ""}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={disabled || previewing} onClick={onPreview}>
            {previewing ? "生成中…" : "试听"}
          </button>
        </div>

        <div className="setting-row">
          <span className="field-label">语速</span>
          <input
            type="range"
            min={0.8}
            max={1.3}
            step={0.05}
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          />
          <span className="progress-text">{speed.toFixed(2)}</span>
        </div>

        <div className="setting-row">
          <span className="field-label">输出</span>
          <span className="doc-meta" style={{ maxWidth: 420 }} title={outputDir}>
            {outputDir || "（未选择）"}
          </span>
          <button className="btn small" onClick={onPickOutput}>
            选择…
          </button>
        </div>
      </div>

      <details className="model-mgmt">
        <summary>模型管理（下载 / 删除）</summary>
        <div style={{ paddingTop: 6 }}>
          {models.map((m) => (
            <div className="model-row" key={m.id}>
              <div className="model-info">
                <strong>{m.name}</strong>
                <span>{m.desc}</span>
              </div>
              {m.installed ? (
                <>
                  <span className="model-size">{m.sizeMB.toFixed(0)} MB</span>
                  <button className="btn small danger" disabled={busy} onClick={() => onDelete(m.id)}>
                    删除
                  </button>
                </>
              ) : (
                <button className="btn small" disabled={busy} onClick={() => onDownload(m.id)}>
                  {busy ? "处理中…" : "下载"}
                </button>
              )}
            </div>
          ))}
          <p className="hint hint-3" style={{ paddingTop: 6 }}>
            英文模型约 330MB、中文模型约 330MB，安装后保存在本机，可随时删除。
            音色文件按需下载（约 1MB/个）。
          </p>
        </div>
      </details>
    </section>
  );
}
