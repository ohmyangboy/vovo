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
  existingVoice,
}: {
  status: CloneStatus | null;
  job: ActiveJob | null;
  run: RunJob;
  onCancel: () => void;
  onClose: () => void;
  onSaved: (voice: SavedVoice) => void;
  onSettings: () => void;
  notify: (message: string, tone?: "error" | "success" | "info") => void;
  existingVoice?: SavedVoice;
}) {
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
  const [name, setName] = useState(existingVoice?.name ?? "我的声音");
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
        setTestText(/[A-Za-z]/.test(result.text) && !/[\u3400-\u9fff]/.test(result.text)
          ? "Every story has a voice. Take a moment, and listen to what comes next."
          : "你好，这是我的声音。今天有个故事，想讲给你听。");
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
    if (!reference || !confirmed || rangeChanged || !authorized || busy || !refText.trim()) return;
    if (!ready) { onSettings(); return; }
    setWorking(true);
    try {
      if (existingVoice) {
        const result = await run("save", "保存参考录音", () =>
          api.addVoiceReference(existingVoice.id, reference.id, refText, authorized));
        if (result) onSaved(result);
      } else {
        const sample = preview ?? await test();
        if (!sample) return;
        const result = await run("save", "保存我的声音", () => api.saveVoice({
          referenceId: reference.id, name, refText, previewId: sample.id, authorized,
        }));
        if (result) onSaved(result);
      }
    } finally { setWorking(false); }
  }
  return (
    <Modal title={existingVoice ? "补充参考录音" : "创建我的声音"}
      description={existingVoice ? "补一段清晰的英文录音，读英文时会优先使用它。最多保留 3 段录音。" : "导入一段录音，核对文字，保存后随时使用。"}
      onClose={onClose} busy={busy}>
      <div className="wizard-body continuous-clone">
        <fieldset disabled={busy}>
          <label className="consent-check import-consent">
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
            <span>这是我本人的声音，或已获得声音本人的明确授权</span>
          </label>
          {!reference ? <>
            <button className="reference-import" aria-label="导入录音并识别文字" disabled={!authorized} onClick={() => void choose()}>
              <Icon name="upload" size={28} /><strong>导入录音并识别文字</strong><span>WAV、MP3、M4A、FLAC、AIFF</span>
            </button>
            <p className="help-text">选一段 3–20 秒的清晰人声，避免背景音乐。用希望的语气自然朗读；读英文时，英文参考录音更合适。</p>
            {!!path && <button className="text-button" onClick={() => void prepare()}>重新读取录音</button>}
          </> : <>
            <div className="reference-toolbar">
              <span>{fileName(path)} · {reference.duration.toFixed(1)} 秒</span>
              <button className="text-button" onClick={() => void choose()}>更换录音</button>
            </div>
            <AudioPlayer path={reference.path} duration={reference.duration} compact />
            {reference.warnings.map((warning) => <p className="warning-text" key={warning}>{warning}</p>)}
            <label className="form-field">
              核对识别文字
              <textarea value={refText} maxLength={1000} rows={4}
                placeholder={transcription === "recognizing" ? "正在识别这段录音，请稍候…" : "试听录音，校正或补全这里的文字。"}
                onChange={(e) => { setRefText(e.target.value); setPreview(undefined); setConfirmed(false); }} />
            </label>
            <div className="transcription-toolbar">
              <p className={"help-text" + (transcription === "error" ? " warning-text" : "")} role="status">
                {transcription === "recognizing" ? "正在识别录音文字…"
                  : transcription === "error" ? "未能自动识别。可以重试，也可以手动填写。"
                  : transcription === "cancelled" ? "识别已取消。可以重试，也可以手动填写。"
                  : "请校正错字、漏字，让文字与录音一致。"}
              </p>
              <button className="text-button" disabled={rangeChanged} onClick={() => void recognize(reference)}>
                <Icon name="refresh" size={14} />重新识别
              </button>
            </div>
            <details className="reference-adjustment">
              <summary>调整录音片段</summary>
              <div className="reference-range">
                <label>从第几秒开始<input type="number" min={0} max={3600} step={0.1} value={start}
                  onChange={(e) => { setStart(Number(e.target.value)); setConfirmed(false); }} /></label>
                <div>
                  <label htmlFor="reference-length">片段长度 <strong>{length} 秒</strong></label>
                  <input id="reference-length" type="range" min={3} max={20} step={1} value={length}
                    onChange={(e) => { setLength(Number(e.target.value)); setConfirmed(false); }} />
                </div>
              </div>
              <button className="button secondary small" disabled={!validRange} onClick={() => void prepare()}>重新读取并识别</button>
              {rangeChanged && <p className="help-text">选段已调整，请重新读取，让录音与文字保持一致。</p>}
            </details>
            <label className="consent-check transcript-confirmation">
              <input type="checkbox" checked={confirmed} disabled={rangeChanged || !refText.trim()}
                onChange={(e) => setConfirmed(e.target.checked)} /><span>我已试听并确认文字与片段一致</span>
            </label>
            {!existingVoice && <label className="form-field">声音名称<input value={name} maxLength={40}
              onChange={(e) => setName(e.target.value)} placeholder="例如：我的旁白声音" /></label>}
            {!existingVoice && <details className="clone-test optional-test">
              <summary>先听听克隆效果</summary>
              <label className="form-field">试听文字<textarea value={testText} rows={2} maxLength={320}
                onChange={(e) => { setTestText(e.target.value); setPreview(undefined); }} /></label>
              <button className="button secondary small" disabled={!ready || !testText.trim() || !confirmed || rangeChanged}
                onClick={() => void test()}><Icon name="play" size={15} />生成短句试听</button>
              {preview && <AudioPlayer path={preview.wav} duration={preview.duration} autoPlay compact />}
            </details>}
            {!ready && <div className="inline-notice"><p>请先准备配音功能。</p><button className="text-button" onClick={onSettings}>前往一键准备<Icon name="chevron" size={14} /></button></div>}
            <p className="help-text">{existingVoice ? "补充录音会作为朗读参考保存在这个声音里，不需要重新下载模型。" : "保存时会一并准备试听示例，下次点击即可听。录音与文字保存在本机。"}</p>
          </>}
        </fieldset>
      </div>
      {job && <JobProgress job={job} onCancel={onCancel} />}
      <footer className="modal-footer">
        <button className="button ghost" disabled={busy} onClick={onClose}>取消</button>
        <span className="spacer" />
        <button className="button primary" disabled={busy || !reference || !name.trim() || !authorized || !confirmed || rangeChanged || !refText.trim()}
          onClick={() => void save()}>{busy ? <span className="spinner" /> : <Icon name="check" size={16} />}{existingVoice ? "保存参考录音" : "保存并使用声音"}</button>
      </footer>
    </Modal>
  );
}
