// 配音工坊 - 跨平台后端
// macOS / Windows / Linux：管理本地 Python 引擎（venv + Kokoro TTS）
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};

const PIP_PACKAGES: &[&str] = &[
    "kokoro>=0.9.4",
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
                .find(|t| t.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
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
        .env("VIRTUAL_ENV", venv_dir());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

fn emit_log(app: &AppHandle, line: &str) {
    let _ = app.emit("engine-log", line.to_string());
}

/// 运行命令并收集完整输出（短命令）。
async fn run_capture(program: &Path, args: &[String], log: Option<&AppHandle>) -> Result<(i32, String), String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
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
    let mut cmd = tokio::process::Command::new(&py);
    cmd.arg(engine_script(app))
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_command(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("启动引擎失败: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let app_out = app.clone();
    let ev_out = event.to_string();
    let t_out = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit(&ev_out, line);
        }
    });

    let app_err = app.clone();
    let ev_err = format!("{event}-log");
    let t_err = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit(&ev_err, line);
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = t_out.await;
    let _ = t_err.await;
    Ok(status.code().unwrap_or(-1))
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
    let out = cmd.output().await.map_err(|e| format!("启动引擎失败: {e}"))?;
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
        .filter(|l| l.trim_start().starts_with('{'))
        .last()
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
    let (code, output) = run_engine_capture(&app, vec!["list-voices".into()]).await?;
    if code != 0 {
        return Err(output);
    }
    Ok(last_json_line(&output))
}

#[tauri::command]
async fn install_engine(app: AppHandle) -> Result<(), String> {
    let support = app_support_dir();
    std::fs::create_dir_all(&support).map_err(|e| e.to_string())?;
    let venv = venv_dir();

    let mut core_ok = false;
    if let Some(uv) = find_uv() {
        emit_log(&app, "使用 uv 创建 Python 环境（3.12）...");
        let (code, _out) = run_capture(
            &uv,
            &[
                "venv".into(),
                "--python".into(),
                "3.12".into(),
                venv.to_string_lossy().into_owned(),
            ],
            Some(&app),
        )
        .await?;
        if code == 0 {
            emit_log(&app, "安装依赖（首次约 200MB，请耐心等待）...");
            let mut args: Vec<String> = vec![
                "pip".into(),
                "install".into(),
                "--python".into(),
                venv_python().to_string_lossy().into_owned(),
            ];
            args.extend(PIP_PACKAGES.iter().map(|s| s.to_string()));
            let (code2, _) = run_capture(&uv, &args, Some(&app)).await?;
            core_ok = code2 == 0;
            if !core_ok {
                emit_log(&app, "uv 安装失败，尝试系统 pip ...");
            }
        } else {
            emit_log(&app, "uv venv 失败，尝试系统 Python ...");
        }
    }

    if !core_ok {
        let py = find_python().ok_or("未找到 Python 3.10+，请先安装 Python（推荐 uv 或 Homebrew）")?;
        emit_log(&app, &format!("使用 {} 创建虚拟环境 ...", py.display()));
        let (code, _) = run_capture(
            &py,
            &["-m".into(), "venv".into(), venv.to_string_lossy().into_owned()],
            Some(&app),
        )
        .await?;
        if code != 0 {
            return Err("创建虚拟环境失败".to_string());
        }
        let pip = venv_pip();
        if !pip.exists() {
            return Err("虚拟环境缺少 pip".to_string());
        }
        emit_log(&app, "安装依赖（首次约 200MB，请耐心等待）...");
        let (code2, _) = run_capture(&pip, &["install".into(), "--upgrade".into(), "pip".into()], Some(&app)).await?;
        if code2 != 0 {
            return Err("pip 升级失败".to_string());
        }
        let mut args: Vec<String> = vec!["install".into()];
        args.extend(PIP_PACKAGES.iter().map(|s| s.to_string()));
        let (code3, _) = run_capture(&pip, &args, Some(&app)).await?;
        if code3 != 0 {
            return Err("依赖安装失败，请检查网络后重试".to_string());
        }
    }

    // 预热英文发音模型（spacy），避免首次合成时联网失败
    emit_log(&app, "预热英文发音模型（约 12MB）...");
    let warm_ok = if let Some(uv) = find_uv() {
        let args = vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            venv_python().to_string_lossy().into_owned(),
            SPACY_MODEL_URL.into(),
        ];
        run_capture(&uv, &args, Some(&app)).await?.0 == 0
    } else {
        run_capture(&venv_pip(), &["install".into(), SPACY_MODEL_URL.into()], Some(&app))
            .await?
            .0
            == 0
    };
    if !warm_ok {
        emit_log(&app, "⚠️ 预热未完成（不影响安装，首次生成时会自动补齐）");
    }

    emit_log(&app, "✅ 引擎安装完成");
    Ok(())
}

#[tauri::command]
async fn download_model(app: AppHandle, model: String) -> Result<serde_json::Value, String> {
    let code = run_engine_stream(&app, vec!["download".into(), "--model".into(), model], "engine-event").await?;
    Ok(serde_json::json!({ "code": code }))
}

#[tauri::command]
async fn delete_model(app: AppHandle, model: String) -> Result<(), String> {
    let (code, output) = run_engine_capture(&app, vec!["delete".into(), "--model".into(), model]).await?;
    if code != 0 {
        return Err(output);
    }
    Ok(())
}

#[tauri::command]
async fn import_doc(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    let (code, output) = run_engine_capture(&app, vec!["import-doc".into(), "--path".into(), path]).await?;
    if code != 0 {
        return Err(output);
    }
    Ok(last_json_line(&output))
}

#[tauri::command]
async fn preview_voice(app: AppHandle, model: String, voice: String) -> Result<String, String> {
    let out = std::env::temp_dir().join(format!("vs_preview_{voice}.mp3"));
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
    let tmp = std::env::temp_dir().join(format!("vs_input_{}.json", std::process::id()));
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
    let _ = std::fs::remove_file(&tmp);
    Ok(serde_json::json!({ "code": code }))
}

#[tauri::command]
fn read_audio(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
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
