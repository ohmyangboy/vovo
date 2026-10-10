import { desktop } from "../api";
import type {
  ActiveJob,
  CloneStatus,
  EnvStatus,
  ExportFormat,
  ModelInfo,
  Preferences,
  VoiceChoice,
} from "../types";
import { Icon } from "./Icon";
import { JobProgress } from "./JobProgress";

export type ResourceAction =
  | "prepare"
  | "install"
  | "download-zh"
  | "download-en"
  | "delete-zh"
  | "delete-en"
  | "install-clone"
  | "download-clone"
  | "delete-clone";
export function SettingsPage({
  env,
  clone,
  models,
  voices,
  preferences,
  onPreferences,
  onDirectory,
  onAction,
  onClearPreviews,
  onRefresh,
  onBack,
  job,
  onCancel,
  logs,
  target,
  onCopy,
}: {
  env: EnvStatus | null;
  clone: CloneStatus | null;
  models: ModelInfo[];
  voices: VoiceChoice[];
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
  onDirectory: () => void;
  onAction: (action: ResourceAction) => void;
  onClearPreviews: () => void;
  onRefresh: () => void;
  onBack: () => void;
  job: ActiveJob | null;
  onCancel: () => void;
  logs: string[];
  target?: string;
  onCopy: (text: string) => void;
}) {
  const busy = !!job;
  const presetVoices = voices;
  const sampleCount = presetVoices.filter((voice) => voice.previewAudio).length;
  const samplesReady = presetVoices.length > 0 && sampleCount === presetVoices.length;
  const dubbingReady = !!env?.ready && models.length >= 2 && models.every((model) => model.installed);
  const cloningReady = !!clone?.installed && clone.engine === "0.5.8" && clone.ffmpeg && clone.transcriptionInstalled;
  const allReady = dubbingReady && samplesReady && !!clone && (!clone.supported || cloningReady);
  const preparing = job?.kind === "prepare";
  function toggleFormat(format: ExportFormat) {
    const formats = preferences.formats.includes(format)
      ? preferences.formats.filter((f) => f !== format)
      : [...preferences.formats, format];
    if (formats.length) onPreferences({ formats });
  }
  return (
    <section className="settings-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">准备一次，专注创作</span>
          <h1>设置</h1>
          <p>把声音准备好，再按自己的习惯创作。</p>
        </div>
        <button className="button secondary" onClick={onBack}>
          <Icon name="back" size={15} />
          返回工作台
        </button>
      </header>
      {!desktop && (
        <div className="inline-notice">
          当前是网页预览。文稿与偏好可保存，资源准备和语音生成需要桌面应用。
        </div>
      )}
      {job && <JobProgress job={job} onCancel={onCancel} />}
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>配音准备</h2>
            <p>自动准备中文、英文、声音试听与本机支持的声音克隆。</p>
          </div>
          <button className="icon-button" title="刷新准备状态" aria-label="刷新准备状态"
            disabled={busy || !desktop} onClick={onRefresh}>
            <Icon name="refresh" size={17} />
          </button>
        </div>
        <div className={`preparation-card${allReady ? " complete" : ""}${target ? " resource-target" : ""}`}>
          <div className="preparation-card-heading">
            <span className="preparation-icon"><Icon name={allReady ? "check" : "download"} size={25} /></span>
            <div>
              <h3>{allReady ? "一切就绪，可以开始创作了" : preparing ? "正在把声音准备好" : "一次准备，随时创作"}</h3>
              <p>{allReady ? clone?.supported ? "声音库点击即可试听，配音与声音克隆也已准备好。" : "声音库点击即可试听，中文和英文配音已准备好。"
                : "只需点击一次，下载与试听准备会自动完成。已有文件会直接复用。"}</p>
            </div>
          </div>
          <div className="preparation-checklist">
            <div className={dubbingReady ? "ready" : ""}>
              <Icon name={dubbingReady ? "check" : "wave"} size={17} />
              <span>中文与英文配音</span>
              <small>{dubbingReady ? "已就绪" : "待准备"}</small>
            </div>
            <div className={samplesReady ? "ready" : ""}>
              <Icon name={samplesReady ? "check" : "play"} size={17} />
              <span>所有声音试听</span>
              <small>{sampleCount} / {presetVoices.length} 个可播放</small>
            </div>
            <div className={cloningReady ? "ready" : ""}>
              <Icon name={cloningReady ? "check" : "mic"} size={17} />
              <span>我的声音 · 克隆与文字识别</span>
              <small>{clone && !clone.supported ? "此设备暂不支持" : cloningReady ? "已就绪" : "待准备"}</small>
            </div>
          </div>
          <div className="preparation-card-footer">
            <p>{preparing ? "可以先试听已完成的声音。暂停后再次点击，会继续准备。"
              : allReady ? "之后无需重复准备，可离线使用。"
              : "首次准备需要联网，可能需要几分钟。完成后可离线使用。"}</p>
            <button className="button primary" disabled={busy || !desktop} onClick={() => onAction("prepare")}>
              {preparing ? <span className="spinner" /> : <Icon name={allReady ? "refresh" : "download"} size={16} />}
              {preparing ? "正在准备…" : allReady ? "检查并准备" : "一键准备全部"}
            </button>
          </div>
        </div>
        <details className="settings-details">
          <summary>资源位置与维护</summary>
          <div>
            <p>配音资源和声音试听保存在 VoiceStudio 的应用数据目录，由应用统一管理。重新准备会复用已有文件。</p>
            <p>macOS：~/Library/Application Support/VoiceStudio/</p>
            <p>models 保存配音资源，samples 保存声音库试听。清理文稿试听缓存不会删除这些已准备好的声音。</p>
            <div className="resource-maintenance">
              {(["zh", "en"] as const).map((id) => {
                const model = models.find((item) => item.id === id);
                return <div key={id}>
                  <div><strong>{id === "zh" ? "中文配音" : "英文配音"}</strong>
                    <small>{id === "zh" ? "Kokoro v1.1-zh" : "Kokoro v1.0"} · Apache 2.0 · {model?.sizeMB.toFixed(0) ?? 0} MB</small></div>
                  <button className="button ghost small" disabled={busy || !desktop || !model?.voices.some((voice) => voice.ready)}
                    onClick={() => onAction(`delete-${id}`)}>移除资源</button>
                </div>;
              })}
              {clone?.supported && <div>
                <div><strong>声音克隆</strong><small>Qwen3-TTS 0.6B Base · MLX · 约 2.52 GB</small></div>
                <button className="button ghost small" disabled={busy || !desktop || !clone.installed}
                  onClick={() => onAction("delete-clone")}>移除资源</button>
              </div>}
            </div>
            <p>移除后可再次一键准备。已保存的声音资料、正式配音与导出文件会保留。</p>
          </div>
        </details>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>保存与导出</h2>
            <p>生成结果保留在本机记录中，随时可以再次导出。</p>
          </div>
        </div>
        <div className="setting-line">
          <div>
            <strong>默认导出位置</strong>
            <p className="directory-path" title={preferences.outputDir}>
              {preferences.outputDir || "导出时选择文件夹"}
            </p>
          </div>
          <button
            className="button secondary small"
            disabled={!desktop}
            onClick={onDirectory}
          >
            <Icon name="folder" size={15} />
            选择文件夹
          </button>
        </div>
        <div className="setting-line">
          <div>
            <strong>生成完成后自动导出</strong>
            <p>使用默认位置与以下格式，无需再次点击导出。</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              aria-label="生成完成后自动导出"
              checked={preferences.autoExport}
              onChange={(e) => onPreferences({ autoExport: e.target.checked })}
            />
            <span />
          </label>
        </div>
        <div className="setting-line">
          <div>
            <strong>默认文件格式</strong>
            <p>MP3 适合分享，WAV 保留原始音频，SRT 是句级字幕。</p>
          </div>
          <div className="format-options">
            {(["mp3", "wav", "srt", "txt"] as const).map((format) => (
              <label key={format}>
                <input
                  type="checkbox"
                  checked={preferences.formats.includes(format)}
                  disabled={
                    preferences.formats.length === 1 &&
                    preferences.formats.includes(format)
                  }
                  onChange={() => toggleFormat(format)}
                />
                {format.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>本地缓存</h2>
            <p>文稿试听会自动保存，重复试听可直接播放。</p>
          </div>
        </div>
        <div className="setting-line">
          <div>
            <strong>清理文稿试听缓存</strong>
            <p>保留声音库已准备好的试听、正式配音、我的声音与参考录音。</p>
          </div>
          <button
            className="button secondary small"
            disabled={busy || !desktop}
            onClick={onClearPreviews}
          >
            清理缓存
          </button>
        </div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading">
          <div>
            <h2>界面偏好</h2>
            <p>保持简单，也照顾你的习惯。</p>
          </div>
        </div>
        <div className="setting-line">
          <strong>外观</strong>
          <div className="segmented">
            {(
              [
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "深色"],
              ] as const
            ).map(([theme, label]) => (
              <button
                aria-pressed={preferences.theme === theme}
                className={preferences.theme === theme ? "active" : ""}
                key={theme}
                onClick={() => onPreferences({ theme })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-line shortcuts">
          <strong>快捷键</strong>
          <span>
            ⌘ / Ctrl + Enter 生成 <span>·</span> ⌘ / Ctrl + O 导入
          </span>
        </div>
      </section>
      <section className="settings-section diagnostics">
        <details className="settings-details">
          <summary>
            诊断详情{logs.length ? `（${logs.length} 条）` : ""}
          </summary>
          <div>
            <p>
              技术信息只在此显示；向他人发送日志前，请检查其中是否包含个人文件路径或文稿内容。
            </p>
            {env?.info?.python && <p>Python {env.info.python}</p>}
            <button className="button secondary small" onClick={() => onCopy(JSON.stringify({ env, clone, logs }, null, 2))}>复制诊断信息</button>
            {env?.raw && <pre>{env.raw}</pre>}
            <pre>{logs.length ? logs.join("\n") : "暂无任务日志"}</pre>
          </div>
        </details>
      </section>
    </section>
  );
}
