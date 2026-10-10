use super::*;

fn progress(app: &AppHandle, stage: &str, label: &str) -> Result<(), String> {
    if jobs::cancelled() {
        return Err("已取消".into());
    }
    jobs::event(
        app,
        serde_json::json!({
            "type": "progress", "stage": stage, "label": label, "done": 0, "total": 0
        }),
    );
    Ok(())
}

/// 所有准备共享一个可取消任务；重复执行会复用已完成的资源与试听。
#[tauri::command]
pub async fn prepare_studio(app: AppHandle, job_id: String) -> Result<(), String> {
    let _job = jobs::Job::start(&job_id)?;
    progress(&app, "environment", "正在准备配音功能…")?;
    if !check_env(app.clone()).await?["ready"]
        .as_bool()
        .unwrap_or(false)
    {
        install_engine_resources(&app).await?;
    }
    progress(&app, "resources", "正在下载中文和英文声音…")?;
    for model in ["zh", "en"] {
        jobs::run(
            &app,
            &venv_python(),
            &[
                engine_script(&app).to_string_lossy().into_owned(),
                "download".into(),
                "--model".into(),
                model.into(),
            ],
        )
        .await?;
    }
    progress(&app, "samples", "正在准备声音试听…")?;
    jobs::run(
        &app,
        &venv_python(),
        &[
            engine_script(&app).to_string_lossy().into_owned(),
            "prepare-samples".into(),
        ],
    )
    .await?;
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        progress(&app, "cloning", "正在准备我的声音…")?;
        let status = clone::clone_status(app.clone()).await?;
        if status["engine"].as_str() != Some("0.5.8")
            || !status["ffmpeg"].as_bool().unwrap_or(false)
        {
            clone::setup_resources(&app).await?;
        }
        if !status["installed"].as_bool().unwrap_or(false)
            || !status["transcriptionInstalled"].as_bool().unwrap_or(false)
        {
            jobs::run(
                &app,
                &clone::python(),
                &[
                    clone::script(&app).to_string_lossy().into_owned(),
                    "download".into(),
                ],
            )
            .await?;
        }
        let status = clone::clone_status(app.clone()).await?;
        if status["engine"].as_str() != Some("0.5.8")
            || !status["installed"].as_bool().unwrap_or(false)
            || !status["ffmpeg"].as_bool().unwrap_or(false)
            || !status["transcriptionInstalled"].as_bool().unwrap_or(false)
        {
            return Err("我的声音尚未准备完整，请检查网络后继续准备".into());
        }
        studio::prepare_saved_samples(&app).await?;
    }
    progress(&app, "ready", "全部准备完成，可以开始创作了")?;
    Ok(())
}
