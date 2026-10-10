import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../api";

type Status = { supported: boolean; engine: string | null; installed: boolean };
export function CloneCard({ disabled, onBusy }: { disabled: boolean; onBusy: (b: boolean) => void }) {
  const [model, setModel] = useState<Status | null>(null);
  const [reference, setReference] = useState("");
  const [refText, setRefText] = useState("");
  const [text, setText] = useState("");
  const [start, setStart] = useState(0);
  const [duration, setDuration] = useState(10);
  const [outdir, setOutdir] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState("");
  const [audio, setAudio] = useState("");
  const url = useRef("");
  const error = useRef("");
  const refresh = async () => {
    try { setModel(await invoke<Status>("clone_status")); }
    catch (e) { setMessage(String(e)); }
  };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const reportError = (e: unknown) => { if (!disposed) setMessage(String(e)); };
    void refresh();
    void api.defaultOutputDir().then(dir => { if (!disposed) setOutdir(dir); }).catch(reportError);
    void listen<string>("clone-event", e => {
      if (!lock.current) return;
      try {
        const v = JSON.parse(e.payload);
        if (v.type === "progress") { setProgress({done:v.done,total:v.total}); setMessage(v.label); }
        if (v.type === "log") setMessage(v.message);
        if (v.type === "error") { error.current = v.message; setMessage(v.message); }
        if (v.type === "done") { if (v.mp3) setResult(v.mp3); setMessage(v.duration ? `完成：${v.duration.toFixed(2)} 秒，本机克隆配音` : v.message); }
      } catch { /* installer output is informational */ }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(reportError);
    return () => { disposed = true; unlisten?.(); if (url.current) URL.revokeObjectURL(url.current); };
  }, []);

  async function run(command: string, req?: object) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); onBusy(true); error.current = "";
    setMessage("准备中…"); setProgress({done:0,total:0});
    if (command === "generate_clone") { setResult(""); setAudio(""); if (url.current) URL.revokeObjectURL(url.current); url.current=""; }
    try { await invoke(command, req ? {req} : {}); }
    catch (e) { setMessage(error.current || String(e)); }
    finally { lock.current = false; setBusy(false); onBusy(false); await refresh(); }
  }
  async function pickReference() {
    const file = await open({multiple:false,filters:[{name:"参考录音",extensions:["wav","m4a","mp3","flac","aiff"]}]});
    if (typeof file === "string") { setReference(file); setRefText(""); }
  }
  async function play() {
    try {
      const bytes = await api.readAudio(result);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type:"audio/mpeg"}));
      setAudio(url.current);
    } catch (e) { setMessage(String(e)); }
  }
  const valid = !!reference && !!refText.trim() && !!text.trim() && !!outdir && start >= 0 && start <= 3600 && duration >= 3 && duration <= 20;
  return <section className="card">
    <h2 className="card-title">本人声音克隆 · Qwen3-TTS Base</h2>
    <p>参考录音与配音仅在本机处理。建议选取 3–20 秒干净人声，并填写该片段准确逐字稿。</p>
    <p>{!isTauri() ? "浏览器仅支持界面预览，请在 npm run tauri dev 打开的桌面窗口中使用。" : model ? (model.supported ? `独立引擎：${model.engine || "未安装"} · 模型：${model.installed ? "已就绪" : "未下载完整（约 2.52 GB）"}` : "需要 Apple Silicon Mac") : "检查模型状态…"}</p>
    <fieldset disabled={busy || disabled || !model?.supported} style={{border:0,padding:0,margin:0}}>
      <div className="row">
        <button className="btn small" onClick={() => void run("setup_clone")}>安装／修复克隆引擎</button>
        <button className="btn small" disabled={!model?.engine} onClick={() => void run("download_clone")}>下载／续传模型</button>
        <button className="btn small" onClick={() => void refresh()}>刷新状态</button>
      </div>
      <p><button className="btn" onClick={() => void pickReference()}>导入参考录音</button> {reference || "未选择"}</p>
      <div className="row">
        <label>起点（秒） <input type="number" min={0} max={3600} value={start} onChange={e=>setStart(Number(e.target.value))}/></label>
        <label>长度（秒） <input type="number" min={3} max={20} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
      </div>
      <label>参考片段逐字稿<textarea style={{width:"100%",minHeight:80}} value={refText} maxLength={1000} onChange={e=>setRefText(e.target.value)} placeholder="填写所选起点和长度内实际说的话，不是目标文案"/></label>
      <label>要生成的目标文本<textarea style={{width:"100%",minHeight:120}} value={text} maxLength={2000} onChange={e=>setText(e.target.value)} placeholder="先输入一句短句验证音色"/></label>
      <p><button className="btn small" onClick={async()=>{const p=await open({directory:true,multiple:false});if(typeof p==="string")setOutdir(p);}}>选择导出文件夹</button> {outdir}</p>
      <button className="btn primary" disabled={!valid || !model?.installed || !model?.engine} onClick={()=>void run("generate_clone",{reference,refText,text,start,duration,outdir})}>生成克隆配音与字幕</button>
    </fieldset>
    {busy && <button className="btn" onClick={()=>{setMessage("正在取消…");void invoke("cancel_clone");}}>取消当前任务</button>}
    {busy && progress.total > 0 && <progress style={{width:"100%"}} max={progress.total} value={progress.done}/>}
    <p role="status" style={{overflowWrap:"anywhere"}}>{message}</p>
    {result && !busy && <div className="row"><button className="btn" onClick={()=>void play()}>载入试听</button><button className="btn" onClick={()=>void revealItemInDir(result)}>打开导出文件（WAV / MP3 / SRT / TXT）</button></div>}
    {audio && <audio controls src={audio} style={{width:"100%"}}/>}
  </section>;
}
