import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, desktop } from "../api";
import { fileName } from "../domain";
import type {
  ActiveJob,
  Bundle,
  CloneStatus,
  PreparedReference,
  SavedVoice,
} from "../types";
import type { RunJob } from "../hooks/useJobs";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { AudioPlayer } from "./AudioPlayer";
import { JobProgress } from "./JobProgress";

export function CloneWizard({
  status,
  job,
  run,
  onCancel,
  onClose,
  onSaved,
  onSettings,
  notify,
}: {
  status: CloneStatus | null;
  job: ActiveJob | null;
  run: RunJob;
  onCancel: () => void;
  onClose: () => void;
  onSaved: (voice: SavedVoice) => void;
  onSettings: () => void;
  notify: (message: string, tone?: "error" | "success" | "info") => void;
}) {
  const [step, setStep] = useState(1);
  const [path, setPath] = useState("");
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(20);
  const [preparedRange, setPreparedRange] = useState({ start: 0, length: 20 });
  const [authorized, setAuthorized] = useState(false);
  const [reference, setReference] = useState<PreparedReference>();
  const [refText, setRefText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [transcription, setTranscription] = useState<
    "idle" | "recognizing" | "success" | "error" | "cancelled"
  >("idle");
  const [name, setName] = useState("我的声音");
  const [testText, setTestText] = useState(
    "你好，这是我的声音。今天有个故事，想讲给你听。",
  );
  const [preview, setPreview] = useState<Bundle>();
  const references = useRef(new Set<string>());
  const busy = !!job || working;
  const rangeChanged = start !== preparedRange.start || length !== preparedRange.length;
  const validRange = Number.isFinite(start) && start >= 0 && start <= 3600;
  const ready =
    !!status?.supported &&
    status.engine === "0.5.8" &&
    status.installed &&
    status.ffmpeg;
  useEffect(
    () => () => {
      const ids = [...references.current];
      void (async () => {
        for (const id of ids)
          try {
            await api.discardReference(id);
          } catch {
            /* 私有暂存仍在应用目录内。 */
          }
      })();
    },
    [],
  );
  async function choose() {
    if (!authorized || busy) return;
    if (!desktop) {
      notify("参考录音导入需要桌面应用", "info");
      return;
    }
    try {
      const file = await open({
        multiple: false,
        filters: [
          {
            name: "参考录音",
            extensions: ["wav", "m4a", "mp3", "flac", "aiff"],
          },
        ],
      });
      if (typeof file === "string") {
        setPath(file);
        setReference(undefined);
        setPreview(undefined);
        setRefText("");
        setConfirmed(false);
        setTranscription("idle");
        setStart(0);
        setLength(20);
        setStep(1);
        await prepare(file, 0, 20);
      }
    } catch (error) {
      notify(String(error), "error");
    }
  }
  async function recognize(target: PreparedReference) {
    setWorking(true);
    setConfirmed(false);
    setTranscription("recognizing");
    let failure = "";
    try {
      const result = await run("transcription", "自动识别片段文字", async (id) => {
        try {
          const transcript = await api.transcribeReference(id, target.id);
          if (transcript.referenceId !== target.id || !transcript.text.trim()) {
            throw new Error("没有识别到有效文字，请重新识别");
          }
          return transcript;
        } catch (error) {
          failure = String(error);
          throw error;
        }
      });
      if (result) {
        setRefText(result.text);
        setPreview(undefined);
        setTranscription("success");
      } else {
        setTranscription(failure.includes("已取消") ? "cancelled" : "error");
      }
    } finally {
      setWorking(false);
    }
  }
  async function prepare(source = path, from = start, duration = length) {
    setWorking(true);
    setConfirmed(false);
    try {
      const result = await run("reference", "读取参考录音", (id) =>
        api.prepareReference(id, { path: source, start: from, duration, authorized }),
      );
      if (result) {
        references.current.add(result.id);
        setReference(result);
        setPreparedRange({ start: from, length: duration });
        setRefText("");
        setPreview(undefined);
        setStep(2);
        await recognize(result);
      }
    } finally {
      setWorking(false);
    }
  }
  async function test() {
    if (!reference) return;
    const result = await run("preview", "试听克隆声音", (id) =>
      api.generateWorkspace(id, {
        model: "clone",
        voice: reference.id,
        voiceName: name,
        title: "声音试听",
        text: testText,
        speed: 1,
        preview: true,
        reference: { id: reference.id, refText },
      }),
    );
    if (result) setPreview(result);
    return result;
  }
  async function save() {
    if (!reference) return;
    if (!ready) { onSettings(); return; }
    const sample = preview ?? await test();
    if (!sample) return;
    const result = await run("save", "保存我的声音", () =>
      api.saveVoice({
        referenceId: reference.id,
        name,
        refText,
        previewId: sample.id,
        authorized,
      }),
    );
    if (result) onSaved(result);
  }
  return (
    <Modal
      title="创建我的声音"
      description="导入录音后自动识别文字，试听核对一次，即可保存并反复使用。"
      onClose={onClose}
      busy={busy}
    >
      <ol className="wizard-steps">
        {["导入录音", "试听校验", "命名保存"].map((label, index) => (
          <li
            className={
              step === index + 1
                ? "current"
                : step > index + 1
                  ? "complete"
                  : ""
            }
            key={label}
          >
            <span>
              {step > index + 1 ? <Icon name="check" size={13} /> : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="wizard-body">
        <fieldset disabled={busy}>
          {step === 1 && (
            <>
              <label className="consent-check import-consent">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                />
                <span>
                  这是我本人的声音，或我已获得声音本人的明确授权。录音与文字仅在本机处理，不会上传。
                </span>
              </label>
              <button
                className={`reference-import${path ? " has-file" : ""}`}
                disabled={!authorized}
                onClick={() => void choose()}
              >
                <Icon name={path ? "file" : "upload"} size={28} />
                <strong>{path ? fileName(path) : "导入录音并识别文字"}</strong>
                <span>
                  WAV、MP3、M4A、FLAC、AIFF
                </span>
              </button>
              <p className="help-text">
                自动读取前 20 秒并识别文字，之后可以试听、调整片段和修改文字。
                请使用至少 3 秒的清晰人声，避免多人说话与背景音乐。
              </p>
              {!status?.transcriptionInstalled && <p className="help-text">
                首次识别会自动下载约 713 MB 的识别资源，完成后可离线使用。
              </p>}
            </>
          )}
          {step === 2 && reference && (
            <>
              <div className="reference-toolbar">
                <span>{fileName(path)} · {preparedRange.start} 秒起 · {reference.duration.toFixed(1)} 秒</span>
                <button className="text-button" onClick={() => void choose()}>更换录音</button>
              </div>
              <div className="reference-preview">
                <div className="waveform" aria-label="参考片段波形">
                  {reference.peaks.map((peak, index) => (
                    <span
                      key={index}
                      style={{ height: `${Math.max(5, peak * 100)}%` }}
                    />
                  ))}
                </div>
                <AudioPlayer
                  path={reference.path}
                  duration={reference.duration}
                />
              </div>
              {reference.warnings.map((warning) => (
                <p className="warning-text" key={warning}>
                  {warning}
                </p>
              ))}
              <label className="form-field">
                核对识别文字
                <textarea
                  value={refText}
                  maxLength={1000}
                  rows={4}
                  placeholder={transcription === "recognizing"
                    ? "正在自动识别这段录音，请稍候…"
                    : "试听所选片段，校正或补全这里的文字。"}
                  onChange={(e) => {
                    setRefText(e.target.value);
                    setPreview(undefined);
                    setConfirmed(false);
                  }}
                />
              </label>
              <div className="transcription-toolbar">
                <p className={`help-text${transcription === "error" ? " warning-text" : ""}`} role="status">
                  {transcription === "recognizing" ? "正在本机识别片段文字，请稍候…"
                    : transcription === "error" ? "未能自动识别。可以重新识别，或试听后手动补全文字。"
                    : transcription === "cancelled" ? "识别已取消。可以重新识别，或试听后手动补全文字。"
                    : "已自动识别。请试听并校正错字、漏字，确保文字与片段一致。"}
                </p>
                <button className="text-button" disabled={rangeChanged}
                  onClick={() => void recognize(reference)}>
                  <Icon name="refresh" size={14} />重新识别
                </button>
              </div>
              <details className="reference-adjustment">
                <summary>调整参考片段</summary>
                <div className="reference-range">
                  <label>
                    从第几秒开始
                    <input type="number" min={0} max={3600} step={0.1} value={start}
                      onChange={(e) => { setStart(Number(e.target.value)); setConfirmed(false); }} />
                  </label>
                  <div>
                    <label htmlFor="reference-length">片段长度 <strong>{length} 秒</strong></label>
                    <input id="reference-length" type="range" min={3} max={20} step={1} value={length}
                      onChange={(e) => { setLength(Number(e.target.value)); setConfirmed(false); }} />
                  </div>
                </div>
                <button className="button secondary small" disabled={!validRange}
                  onClick={() => void prepare()}>重新读取并识别</button>
                {rangeChanged && <p className="help-text">选段已调整，请重新读取，让录音与识别文字保持一致。</p>}
              </details>
              <label className="consent-check transcript-confirmation">
                <input type="checkbox" checked={confirmed} disabled={rangeChanged || !refText.trim()}
                  onChange={(e) => setConfirmed(e.target.checked)} />
                <span>我已试听并确认文字与片段一致</span>
              </label>
            </>
          )}
          {step === 3 && reference && (
            <>
              <label className="form-field">
                声音名称
                <input
                  autoFocus
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：我的旁白声音"
                />
              </label>
              <div className="clone-test">
                <label className="form-field">
                  用一句话听听效果
                  <textarea
                    value={testText}
                    rows={2}
                    maxLength={90}
                    onChange={(e) => {
                      setTestText(e.target.value);
                      setPreview(undefined);
                    }}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!ready || !testText.trim()}
                  onClick={() => void test()}
                >
                  <Icon name="play" size={15} />
                  生成短句试听
                </button>
                {preview && (
                  <AudioPlayer
                    path={preview.wav}
                    duration={preview.duration}
                    autoPlay
                  />
                )}
              </div>
              {!ready && (
                <div className="inline-notice">
                  <p>
                    请先一键准备配音功能，完成后即可保存和试听这个声音。
                  </p>
                  <button className="text-button" onClick={onSettings}>
                    前往一键准备 <Icon name="chevron" size={14} />
                  </button>
                </div>
              )}
              <div className="privacy-card">
                <Icon name="shield" size={18} />
                <p>
                  参考录音与文字仅存于本机。保存时会一并准备声音示例，以后点击即可试听。
                </p>
              </div>
            </>
          )}
        </fieldset>
      </div>
      {job && <JobProgress job={job} onCancel={onCancel} />}
      <footer className="modal-footer">
        <button
          className="button ghost"
          disabled={busy}
          onClick={step === 1 ? onClose : () => setStep(step - 1)}
        >
          {step === 1 ? "取消" : "上一步"}
        </button>
        <span className="spacer" />
        {step === 1 ? (
          <button
            className="button primary"
            disabled={
              busy ||
              !authorized
            }
            onClick={() => void choose()}
          >
            导入并识别 <Icon name="chevron" size={15} />
          </button>
        ) : step === 2 ? (
          <button
            className="button primary"
            disabled={busy || !refText.trim() || !confirmed || rangeChanged}
            onClick={() => setStep(3)}
          >
            确认并继续 <Icon name="chevron" size={15} />
          </button>
        ) : (
          <button
            className="button primary"
            disabled={busy || !name.trim() || !authorized}
            onClick={() => void save()}
          >
            <Icon name="check" size={16} />
            保存并使用声音
          </button>
        )}
      </footer>
    </Modal>
  );
}
