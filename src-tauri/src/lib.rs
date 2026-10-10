mod clone;
mod jobs;
mod setup;
mod studio;
// 配音工坊 - 跨平台后端
// macOS / Windows / Linux：管理本地 Python 引擎（venv + Kokoro TTS）
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

const PIP_PACKAGES: &[&str] = &[
    "kokoro==0.9.4",
    "soundfile",
    "misaki[zh]",
    "numpy",
    "lameenc",
    "python-docx",
    "huggingface_hub",
    "pip",
];

const SPACY_MODEL_URL: &str = "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl";

// ---------------------------------------------------------------- 路径

fn home_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:/"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/"))
    }
}

fn app_support_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home_dir().join("Library/Application Support/VoiceStudio")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"))
            .join("VoiceStudio")
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".local").join("share"))
            .join("VoiceStudio")
    }
}

fn venv_dir() -> PathBuf {
    app_support_dir().join("runtime").join("venv")
}

fn venv_python() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir().join("Scripts").join("python.exe")
    } else {
        venv_dir().join("bin").join("python3")
    }
}

fn venv_pip() -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_dir().join("Scripts").join("pip.exe")
    } else {
        venv_dir().join("bin").join("pip3")
    }
}

// ---------------------------------------------------------------- 可执行文件查找

fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

fn exe_name(base: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn find_uv() -> Option<PathBuf> {
    let home = home_dir();
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/uv"));
        candidates.push(PathBuf::from("/usr/local/bin/uv"));
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/local/bin/uv"));
        candidates.push(PathBuf::from("/usr/bin/uv"));
    }
    candidates.push(home.join(".local").join("bin").join(exe_name("uv")));
    candidates.push(home.join(".cargo").join("bin").join(exe_name("uv")));
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    find_in_path(&[&exe_name("uv")])
}

fn python_ok(exe: &Path) -> bool {
    std::process::Command::new(exe)
        .arg("--version")
        .output()
        .map(|o| {
            let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
            s.push_str(&String::from_utf8_lossy(&o.stderr));
            let ver = s
                .split_whitespace()
                .find(|t| {
                    t.chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                })
                .unwrap_or("");
            let mut it = ver.split('.');
            let major: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            let minor: u32 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            major == 3 && minor >= 10
        })
        .unwrap_or(false)
}

fn find_python() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        for v in ["3.13", "3.12", "3.11", "3.10"] {
            candidates.push(PathBuf::from(format!("/opt/homebrew/bin/python{v}")));
            candidates.push(PathBuf::from(format!("/usr/local/bin/python{v}")));
        }
        candidates.push(PathBuf::from("/usr/bin/python3"));
    }
    #[cfg(target_os = "linux")]
    {
        for v in ["3.13", "3.12", "3.11", "3.10"] {
            candidates.push(PathBuf::from(format!("/usr/bin/python{v}")));
            candidates.push(PathBuf::from(format!("/usr/local/bin/python{v}")));
        }
        candidates.push(PathBuf::from("/usr/bin/python3"));
    }
    if let Some(p) = find_in_path(&["python3", "python"]) {
        candidates.push(p);
    }
    candidates.into_iter().find(|p| p.is_file() && python_ok(p))
}

// ---------------------------------------------------------------- 引擎调用

fn engine_script(app: &AppHandle) -> PathBuf {
    if let Ok(p) = app
        .path()
        .resolve("resources/engine.py", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("engine.py")
}

fn configure_command(cmd: &mut tokio::process::Command) {
    cmd.env("PYTHONWARNINGS", "ignore")
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("VIRTUAL_ENV", venv_dir())
        .env("VOICE_STUDIO_HOME", app_support_dir())
        .env("HF_HUB_DISABLE_TELEMETRY", "1");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

fn emit_log(app: &AppHandle, line: &str) {
    let _ = app.emit("engine-log", line.to_string());
    jobs::event(app, serde_json::json!({"type":"log","message":line}));
}

/// 运行命令并收集完整输出（短命令）。
async fn run_capture(
    program: &Path,
    args: &[String],
    log: Option<&AppHandle>,
) -> Result<(i32, String), String> {
    if let Some(app) = log {
        return match jobs::run(app, program, args).await {
            Ok(value) => Ok((0, value.to_string())),
            Err(error) if jobs::cancelled() => Err(error),
            Err(error) => Ok((1, error)),
        };
    }
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        .env("VOICE_STUDIO_HOME", app_support_dir())
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().await.map_err(|e| format!("启动失败: {e}"))?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr).into_owned();
    if !err.is_empty() {
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(&err);
    }
    if let Some(app) = log {
        for line in s.lines() {
            emit_log(app, line);
        }
    }
    Ok((out.status.code().unwrap_or(-1), s))
}

/// 运行引擎子命令，逐行把 JSON 事件推给前端。
async fn run_engine_stream(app: &AppHandle, args: Vec<String>, event: &str) -> Result<i32, String> {
    let py = venv_python();
    if !py.exists() {
        return Err("引擎未安装".to_string());
    }
    let mut command = vec![engine_script(app).to_string_lossy().into_owned()];
    command.extend(args);
    let result = jobs::run(app, &py, &command).await?;
    let _ = app.emit(event, result.to_string());
    Ok(0)
}

/// 运行引擎子命令并捕获输出（JSON 短命令）。
async fn run_engine_capture(app: &AppHandle, args: Vec<String>) -> Result<(i32, String), String> {
    let py = venv_python();
    if !py.exists() {
        return Err("引擎未安装".to_string());
    }
    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg(engine_script(app))
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_command(&mut cmd);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("启动引擎失败: {e}"))?;
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr).into_owned();
    if !err.is_empty() {
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(&err);
    }
    Ok((out.status.code().unwrap_or(-1), s))
}

fn last_json_line(output: &str) -> serde_json::Value {
    output
        .lines()
        .rfind(|l| l.trim_start().starts_with('{'))
        .and_then(|l| serde_json::from_str(l).ok())
        .unwrap_or(serde_json::json!({}))
}

// ---------------------------------------------------------------- Tauri 命令

#[tauri::command]
fn platform_info() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[tauri::command]
async fn check_env(app: AppHandle) -> Result<serde_json::Value, String> {
    if !venv_python().exists() {
        return Ok(serde_json::json!({
            "installed": false,
            "ready": false,
            "models": {},
        }));
    }
    let (code, output) = run_engine_capture(&app, vec!["check".into()]).await?;
    if code != 0 {
        return Ok(serde_json::json!({
            "installed": true,
            "ready": false,
            "raw": output,
        }));
    }
    let v = last_json_line(&output);
    Ok(serde_json::json!({
        "installed": true,
        "ready": v["ready"].as_bool().unwrap_or(false),
        "info": v,
    }))
}

#[tauri::command]
async fn list_voices(app: AppHandle) -> Result<serde_json::Value, String> {
    let python = if venv_python().is_file() {
        venv_python()
    } else {
        find_python().ok_or("暂无 Python 环境，仍可浏览内置声音目录")?
    };
    let (code, output) = run_capture(
        &python,
        &[
            engine_script(&app).to_string_lossy().into_owned(),
            "list-voices".into(),
        ],
        None,
    )
    .await?;
    if code != 0 {
        return Err(output);
    }
    Ok(last_json_line(&output))
}

#[tauri::command]
async fn install_engine(app: AppHandle, job_id: Option<String>) -> Result<(), String> {
    let _job = clone::Job::start(&job_id.unwrap_or_else(studio::unique_id))?;
    install_engine_resources(&app).await
}

async fn install_engine_resources(app: &AppHandle) -> Result<(), String> {
    let support = app_support_dir();
    std::fs::create_dir_all(&support).map_err(|e| e.to_string())?;
    let venv = venv_dir();

    let mut core_ok = false;
    if let Some(uv) = find_uv() {
        emit_log(app, "使用 uv 创建 Python 环境（3.12）...");
        let code = if venv_python().is_file() {
            0
        } else {
            run_capture(
                &uv,
                &[
                    "venv".into(),
                    "--python".into(),
                    "3.12".into(),
                    venv.to_string_lossy().into_owned(),
                ],
                Some(app),
            )
            .await?
            .0
        };
        if code == 0 {
            emit_log(app, "安装本地依赖，下载量因系统而异，请耐心等待...");
            let mut args: Vec<String> = vec![
                "pip".into(),
                "install".into(),
                "--python".into(),
                venv_python().to_string_lossy().into_owned(),
            ];
            args.extend(PIP_PACKAGES.iter().map(|s| s.to_string()));
            let (code2, _) = run_capture(&uv, &args, Some(app)).await?;
            core_ok = code2 == 0;
            if !core_ok {
                emit_log(app, "uv 安装失败，尝试系统 pip ...");
            }
        } else {
            emit_log(app, "uv venv 失败，尝试系统 Python ...");
        }
    }

    if !core_ok {
        let py =
            find_python().ok_or("未找到 Python 3.10+，请先安装 Python（推荐 uv 或 Homebrew）")?;
        emit_log(app, &format!("使用 {} 创建虚拟环境 ...", py.display()));
        if !venv_python().is_file() {
            let (code, _) = run_capture(
                &py,
                &[
                    "-m".into(),
                    "venv".into(),
                    venv.to_string_lossy().into_owned(),
                ],
                Some(app),
            )
            .await?;
            if code != 0 {
                return Err("创建虚拟环境失败".into());
            }
        }
        let pip = venv_pip();
        if !pip.exists() {
            let (code, _) = run_capture(
                &venv_python(),
                &["-m".into(), "ensurepip".into(), "--upgrade".into()],
                Some(app),
            )
            .await?;
            if code != 0 {
                return Err("无法修复虚拟环境中的 pip，请检查设置中的诊断详情".into());
            }
        }
        emit_log(app, "安装本地依赖，下载量因系统而异，请耐心等待...");
        let (code2, _) = run_capture(
            &pip,
            &["install".into(), "--upgrade".into(), "pip".into()],
            Some(app),
        )
        .await?;
        if code2 != 0 {
            return Err("pip 升级失败".to_string());
        }
        let mut args: Vec<String> = vec!["install".into()];
        args.extend(PIP_PACKAGES.iter().map(|s| s.to_string()));
        let (code3, _) = run_capture(&pip, &args, Some(app)).await?;
        if code3 != 0 {
            return Err("依赖安装失败，请检查网络后重试".to_string());
        }
    }

    // 预热英文发音模型（spacy），避免首次合成时联网失败
    emit_log(app, "预热英文发音模型（约 12MB）...");
    let warm_ok = if let Some(uv) = find_uv() {
        let args = vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            venv_python().to_string_lossy().into_owned(),
            SPACY_MODEL_URL.into(),
        ];
        run_capture(&uv, &args, Some(app)).await?.0 == 0
    } else {
        run_capture(
            &venv_pip(),
            &["install".into(), SPACY_MODEL_URL.into()],
            Some(app),
        )
        .await?
        .0 == 0
    };
    if !warm_ok {
        return Err(
            "英文发音资源未准备完整，请检查网络后重新修复环境。生成时不会自动联网下载".into(),
        );
    }
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    let (code, output) = run_engine_capture(app, vec!["check".into()]).await?;
    if code != 0 || !last_json_line(&output)["ready"].as_bool().unwrap_or(false) {
        return Err("环境准备不完整，请在设置中查看诊断信息后修复".into());
    }
    emit_log(app, "✅ 引擎安装完成");
    Ok(())
}

#[tauri::command]
async fn download_model(
    app: AppHandle,
    model: String,
    job_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let _job = clone::Job::start(&job_id.unwrap_or_else(studio::unique_id))?;
    let code = run_engine_stream(
        &app,
        vec!["download".into(), "--model".into(), model],
        "engine-event",
    )
    .await?;
    Ok(serde_json::json!({ "code": code }))
}

#[tauri::command]
async fn delete_model(app: AppHandle, model: String) -> Result<(), String> {
    let _job = clone::Job::acquire()?;
    let (code, output) =
        run_engine_capture(&app, vec!["delete".into(), "--model".into(), model]).await?;
    if code != 0 {
        return Err(output);
    }
    Ok(())
}

#[tauri::command]
async fn import_doc(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let source = Path::new(&path);
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !source.is_absolute()
        || !source.is_file()
        || !["txt", "md", "markdown", "docx"].contains(&extension.as_str())
    {
        return Err("请选择 TXT、Markdown 或 DOCX 文稿".into());
    }
    if std::fs::metadata(source).map_err(|e| e.to_string())?.len() > 10 * 1024 * 1024 {
        return Err("文稿文件过大，请分段导入".into());
    }
    if extension != "docx" {
        let text =
            std::fs::read_to_string(source).map_err(|_| "文稿不是有效 UTF-8，请转换编码后重试")?;
        let paragraphs: Vec<_> = text
            .trim_start_matches('\u{feff}')
            .split("\n\n")
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .collect();
        return Ok(
            serde_json::json!({"type":extension,"title":source.file_stem().and_then(|s| s.to_str()).unwrap_or("导入文稿"),"count":paragraphs.len(),"paragraphs":paragraphs}),
        );
    }
    let python = if venv_python().is_file() {
        venv_python()
    } else {
        find_python()
            .ok_or("DOCX 导入需要文档解析环境；可以先导入 TXT/MD，或在设置中准备配音环境")?
    };
    let (code, output) = run_capture(
        &python,
        &[
            engine_script(&app).to_string_lossy().into_owned(),
            "import-doc".into(),
            "--path".into(),
            path,
        ],
        None,
    )
    .await?;
    if code != 0 {
        return Err("DOCX 解析失败，请在设置中修复配音环境，或将文稿另存为 TXT/MD".into());
    }
    Ok(last_json_line(&output))
}

#[tauri::command]
async fn preview_voice(app: AppHandle, model: String, voice: String) -> Result<String, String> {
    let _job = clone::Job::acquire()?;
    if !voice
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return Err("声音编号无效".into());
    }
    let directory = app_support_dir().join("previews/legacy");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let out = directory.join(format!("{model}-{voice}.mp3"));
    let args = vec![
        "preview".into(),
        "--model".into(),
        model,
        "--voice".into(),
        voice,
        "--out".into(),
        out.to_string_lossy().into_owned(),
    ];
    let (code, output) = run_engine_capture(&app, args).await?;
    if code != 0 {
        return Err(output);
    }
    Ok(out.to_string_lossy().into_owned())
}

#[derive(Deserialize)]
struct GenerateRequest {
    model: String,
    voice: String,
    speed: f64,
    paragraphs: Vec<String>,
    outdir: String,
    name: String,
}

#[tauri::command]
async fn generate(app: AppHandle, req: GenerateRequest) -> Result<serde_json::Value, String> {
    let _job = clone::Job::acquire()?;
    let requests = app_support_dir().join("runtime/requests");
    std::fs::create_dir_all(&requests).map_err(|e| e.to_string())?;
    let tmp = requests.join(format!("{}.json", studio::unique_id()));
    let _input = clone::RequestFile(tmp.clone());
    let data = serde_json::to_string(&req.paragraphs).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;

    let args = vec![
        "generate".into(),
        "--model".into(),
        req.model,
        "--voice".into(),
        req.voice,
        "--input".into(),
        tmp.to_string_lossy().into_owned(),
        "--outdir".into(),
        req.outdir,
        "--name".into(),
        req.name,
        "--speed".into(),
        format!("{:.2}", req.speed),
    ];
    let code = run_engine_stream(&app, args, "engine-event").await?;
    Ok(serde_json::json!({ "code": code }))
}

#[tauri::command]
fn read_audio(path: String) -> Result<Vec<u8>, String> {
    studio::read_audio_safe(&path)
}

#[tauri::command]
fn default_output_dir(app: AppHandle) -> String {
    app.path()
        .download_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| home_dir().to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            for folder in ["artifacts", "previews", "samples", "voices", "references"] {
                let directory = app_support_dir().join(folder);
                std::fs::create_dir_all(&directory)?;
                app.asset_protocol_scope()
                    .allow_directory(directory, true)?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            clone::clone_status,
            clone::setup_clone,
            clone::download_clone,
            clone::generate_clone,
            clone::cancel_clone,
            clone::delete_clone,
            jobs::cancel_job,
            setup::prepare_studio,
            studio::list_library,
            studio::prepare_reference,
            studio::transcribe_reference,
            studio::discard_reference,
            studio::save_voice,
            studio::delete_voice,
            studio::rename_voice,
            studio::generate_workspace,
            studio::list_history,
            studio::list_previews,
            studio::clear_previews,
            studio::save_captions,
            studio::export_bundle,
            studio::delete_record,
            platform_info,
            check_env,
            list_voices,
            install_engine,
            download_model,
            delete_model,
            import_doc,
            preview_voice,
            generate,
            read_audio,
            default_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
