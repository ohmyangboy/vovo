pub use super::jobs::Job;

pub(crate) struct RequestFile(pub(crate) PathBuf);
impl Drop for RequestFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
use super::*;

pub fn python() -> PathBuf {
    app_support_dir().join("runtime/clone-venv/bin/python3")
}
pub fn script(app: &AppHandle) -> PathBuf {
    app.path()
        .resolve(
            "resources/clone_engine.py",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/clone_engine.py")
        })
}
pub fn ffmpeg() -> Result<PathBuf, String> {
    find_in_path(&[&exe_name("ffmpeg")])
        .or_else(|| {
            ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
                .into_iter()
                .map(PathBuf::from)
                .find(|p| p.is_file())
        })
        .or_else(|| {
            std::fs::read_dir(app_support_dir().join("runtime/clone-venv/lib"))
                .ok()?
                .flatten()
                .find_map(|entry| {
                    std::fs::read_dir(entry.path().join("site-packages/imageio_ffmpeg/binaries"))
                        .ok()?
                        .flatten()
                        .map(|binary| binary.path())
                        .find(|path| {
                            path.is_file()
                                && path.file_name().is_some_and(|name| {
                                    name.to_string_lossy().starts_with("ffmpeg-")
                                })
                        })
                })
        })
        .ok_or_else(|| "音频处理功能尚未准备，请点击一键准备全部".into())
}

#[tauri::command]
pub fn cancel_clone() {
    jobs::cancel_current();
}

#[tauri::command]
pub async fn clone_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let supported = cfg!(all(target_os = "macos", target_arch = "aarch64"));
    if !supported || !python().is_file() {
        return Ok(
            serde_json::json!({"supported":supported,"engine":null,"installed":false,"ffmpeg":ffmpeg().is_ok(),"transcriptionInstalled":false}),
        );
    }
    let (code, output) = run_capture(
        &python(),
        &[script(&app).to_string_lossy().into_owned(), "status".into()],
        None,
    )
    .await?;
    if code != 0 {
        return Err(output);
    }
    let mut status = last_json_line(&output);
    status["supported"] = supported.into();
    status["ffmpeg"] = ffmpeg().is_ok().into();
    Ok(status)
}

#[tauri::command]
pub async fn setup_clone(app: AppHandle, job_id: Option<String>) -> Result<(), String> {
    let _job = Job::start(&job_id.unwrap_or_else(studio::unique_id))?;
    setup_resources(&app).await
}

pub async fn setup_resources(app: &AppHandle) -> Result<(), String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("声音克隆目前需要 Apple Silicon Mac".into());
    }
    if !python().is_file() {
        let dir = app_support_dir().join("runtime/clone-venv");
        if let Some(uv) = find_uv() {
            jobs::run(
                app,
                &uv,
                &[
                    "venv".into(),
                    "--python".into(),
                    "3.12".into(),
                    dir.to_string_lossy().into_owned(),
                ],
            )
            .await?;
        } else {
            let base = if venv_python().is_file() {
                venv_python()
            } else {
                find_python().ok_or("配音功能尚未准备，请点击一键准备全部")?
            };
            jobs::run(
                app,
                &base,
                &[
                    "-m".into(),
                    "venv".into(),
                    dir.to_string_lossy().into_owned(),
                ],
            )
            .await?;
        }
    }
    let (program, mut args) = if let Some(uv) = find_uv() {
        (
            uv,
            vec![
                "pip".into(),
                "install".into(),
                "--python".into(),
                python().to_string_lossy().into_owned(),
            ],
        )
    } else {
        jobs::run(
            app,
            &python(),
            &["-m".into(), "ensurepip".into(), "--upgrade".into()],
        )
        .await?;
        (python(), vec!["-m".into(), "pip".into(), "install".into()])
    };
    args.extend(
        [
            "--index-url",
            "https://pypi.org/simple",
            "mlx-audio==0.5.8",
            "soundfile",
            "huggingface-hub<2",
        ]
        .map(String::from),
    );
    if ffmpeg().is_err() {
        args.extend([
            "--only-binary=imageio-ffmpeg".into(),
            "imageio-ffmpeg==0.6.0".into(),
        ]);
    }
    jobs::run(app, &program, &args).await?;
    ffmpeg()?;
    Ok(())
}

#[tauri::command]
pub async fn download_clone(app: AppHandle, job_id: Option<String>) -> Result<(), String> {
    let _job = Job::start(&job_id.unwrap_or_else(studio::unique_id))?;
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("本地克隆模型不支持当前设备".into());
    }
    jobs::run(
        &app,
        &python(),
        &[
            script(&app).to_string_lossy().into_owned(),
            "download".into(),
        ],
    )
    .await?;
    Ok(())
}

pub async fn run_request(
    app: &AppHandle,
    req: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let tool = ffmpeg()?;
    let requests = app_support_dir().join("runtime/requests");
    std::fs::create_dir_all(&requests).map_err(|e| e.to_string())?;
    let path = requests.join(format!("{}.json", studio::unique_id()));
    let _input = RequestFile(path.clone());
    std::fs::write(&path, serde_json::to_vec(&req).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    jobs::run(
        app,
        &python(),
        &[
            script(app).to_string_lossy().into_owned(),
            "generate".into(),
            "--request".into(),
            path.to_string_lossy().into_owned(),
            "--ffmpeg".into(),
            tool.to_string_lossy().into_owned(),
        ],
    )
    .await
}

pub async fn transcribe(app: &AppHandle, audio: &Path) -> Result<String, String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) || !python().is_file() {
        return Err("文字识别环境尚未准备，请在设置中一键准备全部".into());
    }
    let result = jobs::run(
        app,
        &python(),
        &[
            script(app)
                .with_file_name("transcription.py")
                .to_string_lossy()
                .into_owned(),
            "transcribe".into(),
            "--audio".into(),
            audio.to_string_lossy().into_owned(),
        ],
    )
    .await?;
    let text = result["text"].as_str().unwrap_or("").trim();
    if text.is_empty() || text.chars().count() > 1000 {
        return Err("没有识别到有效文字，请重新识别或试听后补全".into());
    }
    Ok(text.into())
}

#[tauri::command]
pub async fn generate_clone(app: AppHandle, req: serde_json::Value) -> Result<(), String> {
    let _job = Job::acquire()?;
    run_request(&app, req).await?;
    Ok(())
}

#[tauri::command]
pub fn delete_clone() -> Result<(), String> {
    let _job = Job::acquire()?;
    let model = app_support_dir().join("models/qwen3-base-0.6b");
    if model.exists() {
        std::fs::remove_dir_all(model).map_err(|e| e.to_string())?;
    }
    Ok(())
}
