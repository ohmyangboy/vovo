use super::*;
use serde::Serialize;
use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn unique_id() -> String {
    format!(
        "{}-{}-{}",
        now(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}
pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("无效的记录编号".into());
    }
    Ok(())
}
fn folder(name: &str) -> PathBuf {
    app_support_dir().join(name)
}
fn io_error(error: impl std::fmt::Display) -> String {
    format!("无法保存或读取本地文件：{error}")
}
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    atomic_write(path, &serde_json::to_vec_pretty(value).map_err(io_error)?)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.tmp", unique_id()));
    let write = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write {
        let _ = fs::remove_file(&temporary);
        return Err(io_error(error));
    }
    #[cfg(target_os = "windows")]
    let backup = {
        let backup = path.with_extension(format!("{}.bak", unique_id()));
        if path.exists() {
            fs::rename(path, &backup).map_err(io_error)?;
        }
        backup
    };
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        #[cfg(target_os = "windows")]
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(io_error(error));
    }
    #[cfg(target_os = "windows")]
    if backup.exists() {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}
struct Temporary(PathBuf);
impl Temporary {
    fn create(path: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(path.parent().ok_or("路径无效")?).map_err(io_error)?;
        fs::create_dir(&path).map_err(io_error)?;
        Ok(Self(path))
    }
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn managed_file(path: &str, root: &Path) -> Result<PathBuf, String> {
    let canonical = Path::new(path).canonicalize().map_err(io_error)?;
    let root = root.canonicalize().map_err(io_error)?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("文件不在应用管理范围内".into());
    }
    Ok(canonical)
}
pub fn read_audio_safe(path: &str) -> Result<Vec<u8>, String> {
    let root = app_support_dir();
    let file = managed_file(path, &root)?;
    if !["wav", "mp3"].contains(&file.extension().and_then(|s| s.to_str()).unwrap_or("")) {
        return Err("只允许读取应用生成的音频".into());
    }
    if fs::metadata(&file).map_err(io_error)?.len() > 50 * 1024 * 1024 {
        return Err("音频过大，请使用文件流播放器".into());
    }
    fs::read(file).map_err(io_error)
}
fn name_for_file(title: &str) -> String {
    let name: String = title
        .chars()
        .take(70)
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut bytes = 0;
    let name: String = name
        .chars()
        .take_while(|c| {
            bytes += c.len_utf8();
            bytes <= 180
        })
        .collect();
    let name = name.trim_matches([' ', '.']);
    if name.is_empty() {
        return "配音".into();
    }
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str())
    {
        format!("_{name}")
    } else {
        name.into()
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Caption {
    pub start: f64,
    pub end: f64,
    pub text: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub text: String,
    pub model: String,
    pub voice: String,
    #[serde(default)]
    pub model_revision: Option<String>,
    pub voice_name: String,
    pub speed: f64,
    pub created_at: u64,
    pub duration: f64,
    pub sample_rate: u32,
    pub mp3: String,
    pub wav: String,
    pub srt: String,
    pub txt: String,
    pub captions: Vec<Caption>,
    pub caption_revision: u32,
    pub preview: bool,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVoice {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub model: String,
    pub language: String,
    pub reference: String,
    pub ref_text: String,
    pub duration: f64,
    pub created_at: u64,
    pub authorized_at: u64,
    pub preview_audio: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    #[serde(default = "schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub path: String,
    pub duration: f64,
    pub peaks: Vec<f64>,
    pub warnings: Vec<String>,
    pub authorized_at: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceRequest {
    path: String,
    start: f64,
    duration: f64,
    authorized: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVoiceRequest {
    reference_id: String,
    name: String,
    ref_text: String,
    preview_id: Option<String>,
    authorized: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrialReference {
    id: String,
    ref_text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRequest {
    model: String,
    voice: String,
    voice_name: String,
    title: String,
    text: String,
    speed: f64,
    #[serde(default)]
    preview: bool,
    reference: Option<TrialReference>,
}
fn schema_version() -> u32 {
    1
}
fn voice_path(id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    Ok(folder("voices").join(id))
}
fn reference_path(id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    Ok(folder("references").join(id))
}
fn load_voice(id: &str) -> Result<SavedVoice, String> {
    let path = voice_path(id)?;
    let mut voice: SavedVoice =
        serde_json::from_slice(&fs::read(path.join("voice.json")).map_err(io_error)?)
            .map_err(io_error)?;
    if voice.schema_version != 1
        || voice.id != id
        || voice.model != "clone"
        || voice.authorized_at == 0
        || !(3.0..=20.01).contains(&voice.duration)
    {
        return Err("声音资料无效或版本不兼容".into());
    }
    managed_file(&voice.reference, &path)?;
    if voice
        .preview_audio
        .as_ref()
        .is_some_and(|file| managed_file(file, &path).is_err())
    {
        voice.preview_audio = None;
    }
    Ok(voice)
}
fn load_bundle(id: &str, preview: bool) -> Result<Bundle, String> {
    validate_id(id)?;
    let path = folder(if preview { "previews" } else { "artifacts" }).join(id);
    let bundle: Bundle =
        serde_json::from_slice(&fs::read(path.join("manifest.json")).map_err(io_error)?)
            .map_err(io_error)?;
    if bundle.schema_version != 1
        || bundle.id != id
        || bundle.preview != preview
        || !bundle.duration.is_finite()
        || bundle.duration <= 0.0
        || !(8000..=96000).contains(&bundle.sample_rate)
    {
        return Err("生成记录无效或版本不兼容".into());
    }
    for file in [&bundle.mp3, &bundle.wav, &bundle.srt, &bundle.txt] {
        managed_file(file, &path)?;
    }
    validate_captions(&bundle.captions, bundle.duration)?;
    Ok(bundle)
}

#[tauri::command]
pub fn list_library() -> Result<Vec<SavedVoice>, String> {
    let root = folder("voices");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut voices = vec![];
    for entry in fs::read_dir(root).map_err(io_error)?.flatten() {
        if let Some(id) = entry.file_name().to_str() {
            if let Ok(voice) = load_voice(id) {
                voices.push(voice);
            }
        }
    }
    voices.sort_by_key(|v| std::cmp::Reverse(v.created_at));
    Ok(voices)
}

fn waveform(path: &Path) -> Result<(f64, Vec<f64>, Vec<String>), String> {
    let bytes = fs::read(path).map_err(io_error)?;
    if bytes.len() < 44
        || bytes.len() > 1_100_000
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err("参考片段无法读取".into());
    }
    let mut offset = 12;
    let mut samples = vec![];
    let mut format_valid = false;
    while offset + 8 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let end = start
            .checked_add(size)
            .filter(|n| *n <= bytes.len())
            .ok_or("参考音频数据不完整")?;
        if &bytes[offset..offset + 4] == b"fmt " && size >= 16 {
            format_valid = u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap()) == 1
                && u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()) == 1
                && u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()) == 24000
                && u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) == 16;
        }
        if &bytes[offset..offset + 4] == b"data" {
            samples = bytes[start..end]
                .chunks_exact(2)
                .map(|n| i16::from_le_bytes([n[0], n[1]]) as f64 / 32768.0)
                .collect();
        }
        offset = end + size % 2;
    }
    let duration = samples.len() as f64 / 24000.0;
    if !format_valid || !(3.0..=20.01).contains(&duration) {
        return Err("所选片段不足 3 秒或超出 20 秒，请调整选段".into());
    }
    let peak = samples.iter().fold(0.0_f64, |p, n| p.max(n.abs()));
    if peak < 0.001 {
        return Err("参考片段为空或接近静音，请重新选段".into());
    }
    let mut warnings = vec![];
    let rms = (samples.iter().map(|n| n * n).sum::<f64>() / samples.len() as f64).sqrt();
    if rms < 0.01 {
        warnings.push("录音音量偏低，建议换一个人声更清晰的片段".into());
    }
    if samples.iter().filter(|n| n.abs() > 0.995).count() as f64 / samples.len() as f64 > 0.01 {
        warnings.push("录音可能存在削波失真，建议降低录音音量".into());
    }
    let width = samples.len().div_ceil(96);
    let peaks = samples
        .chunks(width)
        .map(|chunk| chunk.iter().fold(0.0_f64, |p, n| p.max(n.abs())))
        .collect();
    Ok((duration, peaks, warnings))
}

#[tauri::command]
pub async fn prepare_reference(
    app: AppHandle,
    job_id: String,
    req: ReferenceRequest,
) -> Result<Reference, String> {
    let _job = jobs::Job::start(&job_id)?;
    if !req.authorized {
        return Err("请确认你有权使用这段声音".into());
    }
    if !req.start.is_finite()
        || !(0.0..=3600.0).contains(&req.start)
        || !req.duration.is_finite()
        || !(3.0..=20.0).contains(&req.duration)
    {
        return Err("起点或片段长度无效".into());
    }
    let source = Path::new(&req.path);
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !source.is_absolute()
        || !source.is_file()
        || !["wav", "m4a", "mp3", "flac", "aiff"].contains(&extension.as_str())
    {
        return Err("请选择本机录音文件".into());
    }
    let root = reference_path(&job_id)?;
    let temporary = Temporary::create(folder("references").join(format!(".tmp-{job_id}")))?;
    let wav = temporary.0.join("reference.wav");
    jobs::event(
        &app,
        serde_json::json!({"type":"progress","stage":"reference","label":"准备参考片段…"}),
    );
    let tool = clone::ffmpeg()?;
    let arguments = vec![
        "-nostdin".into(),
        "-v".into(),
        "error".into(),
        "-protocol_whitelist".into(),
        "file,pipe".into(),
        "-threads".into(),
        "1".into(),
        "-ss".into(),
        req.start.to_string(),
        "-i".into(),
        req.path,
        "-t".into(),
        req.duration.to_string(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "24000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        wav.to_string_lossy().into_owned(),
    ];
    let task = jobs::run(&app, &tool, &arguments);
    tokio::time::timeout(std::time::Duration::from_secs(60), task)
        .await
        .map_err(|_| "参考录音读取超时，请换一个片段")??;
    let (duration, peaks, warnings) = waveform(&wav)?;
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    let reference = Reference {
        schema_version: 1,
        id: job_id,
        path: root.join("reference.wav").to_string_lossy().into_owned(),
        duration,
        peaks,
        warnings,
        authorized_at: now(),
    };
    write_json(&temporary.0.join("reference.json"), &reference)?;
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    fs::rename(&temporary.0, root).map_err(io_error)?;
    Ok(reference)
}

#[tauri::command]
pub async fn transcribe_reference(
    app: AppHandle,
    job_id: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let _job = jobs::Job::start(&job_id)?;
    let root = reference_path(&id)?;
    let reference: Reference =
        serde_json::from_slice(&fs::read(root.join("reference.json")).map_err(io_error)?)
            .map_err(io_error)?;
    if reference.authorized_at == 0 {
        return Err("请确认你有权使用这段声音".into());
    }
    let wav = managed_file(&reference.path, &root)?;
    waveform(&wav)?;
    let text = clone::transcribe(&app, &wav).await?;
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    Ok(serde_json::json!({"referenceId":id,"text":text}))
}

#[tauri::command]
pub fn discard_reference(id: String) -> Result<(), String> {
    let _job = jobs::Job::acquire()?;
    let path = reference_path(&id)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(io_error)?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_voice(req: SaveVoiceRequest) -> Result<SavedVoice, String> {
    let _job = jobs::Job::acquire()?;
    if !req.authorized {
        return Err("请确认声音使用授权".into());
    }
    let name = req.name.trim();
    let ref_text = req.ref_text.trim();
    if name.is_empty()
        || name.chars().count() > 40
        || ref_text.is_empty()
        || ref_text.chars().count() > 1000
    {
        return Err("请填写声音名称（最多 40 字）与准确的参考文字（最多 1000 字）".into());
    }
    let source = reference_path(&req.reference_id)?;
    let reference: Reference =
        serde_json::from_slice(&fs::read(source.join("reference.json")).map_err(io_error)?)
            .map_err(io_error)?;
    let wav = managed_file(&reference.path, &source)?;
    let id = unique_id();
    let root = voice_path(&id)?;
    let temporary = Temporary::create(folder("voices").join(format!(".tmp-{id}")))?;
    fs::copy(wav, temporary.0.join("reference.wav")).map_err(io_error)?;
    let mut preview_audio = None;
    if let Some(preview_id) = req.preview_id {
        let preview = load_bundle(&preview_id, true)?;
        if preview.model != "clone" || preview.voice != reference.id {
            return Err("试听结果与参考声音不一致".into());
        }
        fs::copy(&preview.mp3, temporary.0.join("preview.mp3")).map_err(io_error)?;
        preview_audio = Some(root.join("preview.mp3").to_string_lossy().into_owned());
    }
    let voice = SavedVoice {
        schema_version: 1,
        id,
        name: name.into(),
        model: "clone".into(),
        language: "zh".into(),
        reference: root.join("reference.wav").to_string_lossy().into_owned(),
        ref_text: ref_text.into(),
        duration: reference.duration,
        created_at: now(),
        authorized_at: now(),
        preview_audio,
    };
    write_json(&temporary.0.join("voice.json"), &voice)?;
    fs::rename(&temporary.0, &root).map_err(io_error)?;
    let _ = fs::remove_dir_all(source);
    Ok(voice)
}

#[tauri::command]
pub fn rename_voice(id: String, name: String) -> Result<SavedVoice, String> {
    let _job = jobs::Job::acquire()?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err("声音名称须为 1–40 字".into());
    }
    let mut voice = load_voice(&id)?;
    voice.name = name.into();
    write_json(&voice_path(&id)?.join("voice.json"), &voice)?;
    Ok(voice)
}

#[tauri::command]
pub fn delete_voice(id: String) -> Result<(), String> {
    let _job = jobs::Job::acquire()?;
    fs::remove_dir_all(voice_path(&id)?).map_err(io_error)
}

#[tauri::command]
pub async fn generate_workspace(
    app: AppHandle,
    job_id: String,
    req: WorkspaceRequest,
) -> Result<Bundle, String> {
    let _job = jobs::Job::start(&job_id)?;
    let text = req.text.trim();
    let max = if req.model == "clone" { 2000 } else { 10000 };
    if text.is_empty() || text.chars().count() > max {
        return Err(format!("文稿须为 1–{max} 字"));
    }
    if !req.speed.is_finite()
        || (req.model == "clone" && req.speed != 1.0)
        || (req.model != "clone" && !(0.8..=1.3).contains(&req.speed))
    {
        return Err("当前模型不支持所选语速".into());
    }
    let category = if req.preview { "previews" } else { "artifacts" };
    let temporary = Temporary::create(folder(category).join(format!(".tmp-{job_id}")))?;
    let done = if req.model == "clone" {
        if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            return Err("本地克隆目前需要 Apple Silicon Mac".into());
        }
        let (reference, ref_text, duration) = if let Some(trial) = &req.reference {
            let root = reference_path(&trial.id)?;
            let reference: Reference =
                serde_json::from_slice(&fs::read(root.join("reference.json")).map_err(io_error)?)
                    .map_err(io_error)?;
            (
                managed_file(&reference.path, &root)?
                    .to_string_lossy()
                    .into_owned(),
                trial.ref_text.clone(),
                reference.duration,
            )
        } else {
            let voice = load_voice(&req.voice)?;
            (voice.reference, voice.ref_text, voice.duration)
        };
        clone::run_request(&app, serde_json::json!({"reference":reference,"refText":ref_text,"text":text,"start":0,"duration":duration.min(20.0),"outdir":temporary.0,"name":"audio"})).await?
    } else {
        if !["en", "zh"].contains(&req.model.as_str()) || req.reference.is_some() {
            return Err("请选择支持的配音模型".into());
        }
        let input = temporary.0.join("input.json");
        write_json(&input, &text.split("\n\n").collect::<Vec<_>>())?;
        jobs::event(
            &app,
            serde_json::json!({"type":"progress","stage":"load","label":"正在载入声音…"}),
        );
        jobs::run(
            &app,
            &venv_python(),
            &[
                engine_script(&app).to_string_lossy().into_owned(),
                "generate".into(),
                "--model".into(),
                req.model.clone(),
                "--voice".into(),
                req.voice.clone(),
                "--input".into(),
                input.to_string_lossy().into_owned(),
                "--outdir".into(),
                temporary.0.to_string_lossy().into_owned(),
                "--name".into(),
                "audio".into(),
                "--speed".into(),
                req.speed.to_string(),
            ],
        )
        .await?
    };
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    for key in ["mp3", "wav", "srt", "txt", "captions"] {
        let path = managed_file(
            done[key].as_str().ok_or("任务没有返回完整结果")?,
            &temporary.0,
        )?;
        if fs::metadata(path).map_err(io_error)?.len() == 0 {
            return Err("任务返回了空文件".into());
        }
    }
    let duration = done["duration"]
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or("音频时长无效")?;
    let captions: Vec<Caption> =
        serde_json::from_slice(&fs::read(done["captions"].as_str().unwrap()).map_err(io_error)?)
            .map_err(io_error)?;
    validate_captions(&captions, duration)?;
    let root = folder(category).join(&job_id);
    let bundle = Bundle {
        schema_version: 1,
        id: job_id,
        title: if req.title.trim().is_empty() {
            "未命名配音".into()
        } else {
            req.title.trim().chars().take(100).collect()
        },
        text: text.into(),
        model: req.model,
        voice: req.voice,
        voice_name: req.voice_name.chars().take(80).collect(),
        speed: req.speed,
        created_at: now(),
        duration,
        model_revision: done["modelRevision"].as_str().map(str::to_owned),
        sample_rate: done["sampleRate"].as_u64().ok_or("采样率无效")? as u32,
        mp3: root.join("audio.mp3").to_string_lossy().into_owned(),
        wav: root.join("audio.wav").to_string_lossy().into_owned(),
        srt: root.join("audio.srt").to_string_lossy().into_owned(),
        txt: root.join("audio.txt").to_string_lossy().into_owned(),
        captions,
        caption_revision: 0,
        preview: req.preview,
    };
    let _ = fs::remove_file(temporary.0.join("input.json"));
    write_json(&temporary.0.join("manifest.json"), &bundle)?;
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    fs::rename(&temporary.0, root).map_err(io_error)?;
    Ok(bundle)
}

#[tauri::command]
pub fn list_history() -> Result<Vec<Bundle>, String> {
    let root = folder("artifacts");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut bundles = vec![];
    for entry in fs::read_dir(root).map_err(io_error)?.flatten() {
        if let Some(id) = entry.file_name().to_str() {
            if let Ok(bundle) = load_bundle(id, false) {
                bundles.push(bundle);
            }
        }
    }
    bundles.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    Ok(bundles)
}
#[tauri::command]
pub fn list_previews() -> Result<Vec<Bundle>, String> {
    let root = folder("previews");
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut bundles = vec![];
    for entry in fs::read_dir(root).map_err(io_error)?.flatten() {
        if let Some(id) = entry.file_name().to_str() {
            if let Ok(bundle) = load_bundle(id, true) {
                bundles.push(bundle);
            }
        }
    }
    bundles.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    bundles.truncate(200);
    Ok(bundles)
}

pub async fn prepare_saved_samples(app: &AppHandle) -> Result<(), String> {
    let voices = list_library()?;
    let total = voices.len();
    for (index, mut voice) in voices.into_iter().enumerate() {
        if jobs::cancelled() {
            return Err("已取消".into());
        }
        if voice.preview_audio.is_some() {
            continue;
        }
        jobs::event(
            app,
            serde_json::json!({"type": "progress", "stage": "cloned-samples",
            "voiceKey": format!("clone:{}", voice.id), "done": index, "total": total,
            "label": "正在准备我的声音试听…"}),
        );
        let temporary =
            Temporary::create(folder("voices").join(format!(".sample-{}", unique_id())))?;
        let result = clone::run_request(
            app,
            serde_json::json!({
                "text": "你好，这是我的声音。今天有个故事，想讲给你听。",
                "reference": voice.reference, "refText": voice.ref_text,
                "start": 0, "duration": voice.duration, "outdir": temporary.0, "name": "试听",
            }),
        )
        .await?;
        let source = result["mp3"]
            .as_str()
            .ok_or("声音试听未生成完整，请继续准备")?;
        let root = voice_path(&voice.id)?;
        let audio = root.join("preview.mp3");
        let pending = root.join("preview.mp3.tmp");
        fs::copy(managed_file(source, &temporary.0)?, &pending).map_err(io_error)?;
        fs::rename(&pending, &audio).map_err(io_error)?;
        voice.preview_audio = Some(audio.to_string_lossy().into_owned());
        write_json(&root.join("voice.json"), &voice)?;
        jobs::event(
            app,
            serde_json::json!({"type": "sample-ready", "voiceKey": format!("clone:{}", voice.id),
            "previewAudio": audio, "previewDuration": result["duration"]}),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn clear_previews() -> Result<(), String> {
    let _job = jobs::Job::acquire()?;
    let root = folder("previews");
    if root.exists() {
        fs::remove_dir_all(&root).map_err(io_error)?;
    }
    fs::create_dir_all(root).map_err(io_error)
}
fn validate_captions(captions: &[Caption], duration: f64) -> Result<(), String> {
    if !duration.is_finite() || duration <= 0.0 || captions.is_empty() || captions.len() > 10000 {
        return Err("音频时长或字幕无效".into());
    }
    let mut previous = 0.0;
    for caption in captions {
        if !caption.start.is_finite()
            || !caption.end.is_finite()
            || caption.start < 0.0
            || caption.start < previous - 0.001
            || caption.end <= caption.start
            || caption.end > duration + 0.001
            || caption.text.trim().is_empty()
            || caption.text.chars().count() > 2000
        {
            return Err("字幕内容或时间轴无效".into());
        }
        previous = caption.end;
    }
    Ok(())
}
fn timestamp(seconds: f64) -> String {
    let ms = (seconds * 1000.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
fn srt(captions: &[Caption]) -> String {
    captions
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let plain = c.text.split_whitespace().collect::<Vec<_>>().join(" ");
            let chars: Vec<_> = plain.chars().collect();
            let limit = if chars.iter().any(|c| ('\u{3400}'..='\u{9fff}').contains(c)) {
                22
            } else {
                44
            };
            let display = if c.text.contains('\n') {
                c.text
                    .lines()
                    .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
                    .filter(|line| !line.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            } else if chars.len() > limit {
                let middle = chars.len() / 2;
                let cut = chars
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| c.is_whitespace())
                    .map(|(i, _)| i)
                    .min_by_key(|i| i.abs_diff(middle))
                    .unwrap_or(middle);
                format!(
                    "{}\n{}",
                    chars[..cut].iter().collect::<String>().trim(),
                    chars[cut..].iter().collect::<String>().trim()
                )
            } else {
                plain
            };
            format!(
                "{}\n{} --> {}\n{}\n",
                i + 1,
                timestamp(c.start),
                timestamp(c.end),
                display
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub fn save_captions(id: String, captions: Vec<Caption>) -> Result<Bundle, String> {
    let _job = jobs::Job::acquire()?;
    let mut bundle = load_bundle(&id, false)?;
    validate_captions(&captions, bundle.duration)?;
    bundle.captions = captions;
    bundle.caption_revision = bundle
        .caption_revision
        .checked_add(1)
        .ok_or("字幕版本已超出上限")?;
    let root = folder("artifacts").join(&id);
    let subtitle = root.join(format!("captions-r{}.srt", bundle.caption_revision));
    atomic_write(&subtitle, srt(&bundle.captions).as_bytes())?;
    bundle.srt = subtitle.to_string_lossy().into_owned();
    if let Err(error) = write_json(&root.join("manifest.json"), &bundle) {
        let _ = fs::remove_file(subtitle);
        return Err(error);
    }
    Ok(bundle)
}

#[tauri::command]
pub fn export_bundle(
    id: String,
    directory: String,
    formats: Vec<String>,
) -> Result<String, String> {
    let _job = jobs::Job::acquire()?;
    let bundle = load_bundle(&id, false)?;
    export_files(&bundle, Path::new(&directory), &formats)
}
fn export_files(bundle: &Bundle, destination: &Path, formats: &[String]) -> Result<String, String> {
    if formats.is_empty()
        || formats
            .iter()
            .any(|f| !["mp3", "wav", "srt", "txt"].contains(&f.as_str()))
    {
        return Err("请选择有效的导出格式".into());
    }
    if !destination.is_absolute() || !destination.is_dir() {
        return Err("请选择存在的导出文件夹".into());
    }
    let suffix = unique_id();
    let name = format!("{}-{suffix}", name_for_file(&bundle.title));
    let temporary = Temporary::create(destination.join(format!(".voicestudio-{suffix}")))?;
    for format in formats {
        let output = temporary
            .0
            .join(format!("{}.{}", name_for_file(&bundle.title), format));
        if format == "srt" {
            fs::write(output, srt(&bundle.captions)).map_err(io_error)?;
        } else {
            let source = match format.as_str() {
                "mp3" => &bundle.mp3,
                "wav" => &bundle.wav,
                _ => &bundle.txt,
            };
            fs::copy(source, output).map_err(io_error)?;
        }
    }
    let output = destination.join(name);
    fs::rename(&temporary.0, &output).map_err(io_error)?;
    Ok(output.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn delete_record(id: String) -> Result<(), String> {
    let _job = jobs::Job::acquire()?;
    validate_id(&id)?;
    fs::remove_dir_all(folder("artifacts").join(id)).map_err(io_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_reject_traversal() {
        for id in ["../private", "/tmp", "", "a.b", "a/b"] {
            assert!(validate_id(id).is_err());
        }
        assert!(validate_id("task-123-a").is_ok());
        assert_eq!(name_for_file("../配音:稿"), "_配音_稿");
        assert_eq!(name_for_file("NUL"), "_NUL");
        assert_eq!(name_for_file("CON.txt"), "_CON.txt");
        assert!(name_for_file(&"🎙".repeat(100)).len() <= 180);
    }
    #[test]
    fn captions_reject_overlap_and_overflow() {
        let good = Caption {
            start: 0.0,
            end: 1.0,
            text: "你好".into(),
        };
        assert!(validate_captions(&[good.clone()], 1.0).is_ok());
        assert!(validate_captions(&[good.clone(), good.clone()], 2.0).is_err());
        assert!(validate_captions(&[good], 0.5).is_err());
        assert_eq!(timestamp(59.9999), "00:01:00,000");
        assert!(srt(&[Caption {
            start: 0.0,
            end: 1.0,
            text: "第一行\n第二行".into()
        }])
        .contains("第一行\n第二行"));
    }
    #[test]
    fn export_is_versioned_and_failed_copy_leaves_no_partial_folder() {
        let root =
            Temporary::create(std::env::temp_dir().join(format!("vs-export-test-{}", unique_id())))
                .unwrap();
        let source = root.0.join("source");
        let destination = root.0.join("exports");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        for extension in ["mp3", "wav", "srt", "txt"] {
            fs::write(source.join(format!("audio.{extension}")), b"source").unwrap();
        }
        let mut bundle = Bundle {
            schema_version: 1,
            id: "sample".into(),
            title: "同名稿件".into(),
            text: "文稿".into(),
            model: "zh".into(),
            voice: "zf_001".into(),
            voice_name: "中文声音".into(),
            model_revision: None,
            speed: 1.0,
            created_at: 1,
            duration: 1.0,
            sample_rate: 24000,
            mp3: source.join("audio.mp3").to_string_lossy().into(),
            wav: source.join("audio.wav").to_string_lossy().into(),
            srt: source.join("audio.srt").to_string_lossy().into(),
            txt: source.join("audio.txt").to_string_lossy().into(),
            captions: vec![Caption {
                start: 0.0,
                end: 0.8,
                text: "字幕".into(),
            }],
            caption_revision: 0,
            preview: false,
        };
        let formats = vec!["mp3".into(), "srt".into()];
        let first = export_files(&bundle, &destination, &formats).unwrap();
        let second = export_files(&bundle, &destination, &formats).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            fs::read(Path::new(&first).join("同名稿件.mp3")).unwrap(),
            b"source"
        );
        assert!(fs::read_to_string(Path::new(&second).join("同名稿件.srt"))
            .unwrap()
            .contains("字幕"));
        bundle.mp3 = source.join("missing.mp3").to_string_lossy().into();
        assert!(export_files(&bundle, &destination, &["txt".into(), "mp3".into()]).is_err());
        assert_eq!(fs::read_dir(destination).unwrap().count(), 2);
    }
    #[test]
    fn waveform_validates_reference_duration_format_and_silence() {
        let root =
            Temporary::create(std::env::temp_dir().join(format!("vs-wave-test-{}", unique_id())))
                .unwrap();
        let path = root.0.join("sample.wav");
        let make_wave = |count: usize, sample: i16| {
            let mut bytes = b"RIFF".to_vec();
            bytes.extend(((36 + count * 2) as u32).to_le_bytes());
            bytes.extend(b"WAVEfmt ");
            bytes.extend(16_u32.to_le_bytes());
            bytes.extend(1_u16.to_le_bytes());
            bytes.extend(1_u16.to_le_bytes());
            bytes.extend(24000_u32.to_le_bytes());
            bytes.extend(48000_u32.to_le_bytes());
            bytes.extend(2_u16.to_le_bytes());
            bytes.extend(16_u16.to_le_bytes());
            bytes.extend(b"data");
            bytes.extend((count as u32 * 2).to_le_bytes());
            for _ in 0..count {
                bytes.extend(sample.to_le_bytes());
            }
            fs::write(&path, bytes).unwrap();
        };
        make_wave(72000, 1000);
        let (duration, peaks, _) = waveform(&path).unwrap();
        assert_eq!(duration, 3.0);
        assert_eq!(peaks.len(), 96);
        make_wave(72000, 0);
        assert!(waveform(&path).is_err());
        make_wave(24000, 1000);
        assert!(waveform(&path).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn managed_file_rejects_symlink_escape() {
        let root =
            Temporary::create(std::env::temp_dir().join(format!("vs-scope-test-{}", unique_id())))
                .unwrap();
        let managed = root.0.join("managed");
        fs::create_dir(&managed).unwrap();
        let outside = root.0.join("private.wav");
        fs::write(&outside, b"private").unwrap();
        let link = managed.join("audio.wav");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(managed_file(&link.to_string_lossy(), &managed).is_err());
    }
    #[test]
    fn unique_export_names_and_atomic_updates() {
        let path = std::env::temp_dir().join(format!("vs-test-{}", unique_id()));
        fs::create_dir(&path).unwrap();
        let file = path.join("index.json");
        atomic_write(&file, b"first").unwrap();
        atomic_write(&file, b"second").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"second");
        assert_ne!(unique_id(), unique_id());
        fs::remove_dir_all(path).unwrap();
    }
}
