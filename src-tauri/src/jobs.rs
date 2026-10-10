use super::*;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
static CURRENT: Mutex<Option<String>> = Mutex::new(None);

pub struct Job;
impl Job {
    pub fn acquire() -> Result<Self, String> {
        Self::start(&format!("task-{}", super::studio::unique_id()))
    }
    pub fn start(id: &str) -> Result<Self, String> {
        super::studio::validate_id(id)?;
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "已有任务正在运行，请稍后再试".to_string())?;
        CANCEL.store(false, Ordering::SeqCst);
        SEQUENCE.store(0, Ordering::SeqCst);
        *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(id.into());
        Ok(Self)
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = None;
        BUSY.store(false, Ordering::SeqCst);
    }
}
pub fn cancelled() -> bool {
    CANCEL.load(Ordering::SeqCst)
}
pub fn cancel_current() {
    if BUSY.load(Ordering::SeqCst) {
        CANCEL.store(true, Ordering::SeqCst);
    }
}
fn event_for(app: &AppHandle, mut payload: serde_json::Value, source: Option<&str>) {
    if !payload.is_object() {
        return;
    }
    let current = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(id) = current.as_deref().filter(|id| Some(*id) == source) {
        payload["jobId"] = id.into();
        payload["sequence"] = SEQUENCE.fetch_add(1, Ordering::SeqCst).into();
        drop(current);
        let _ = app.emit("studio-event", payload);
    }
}
pub fn event(app: &AppHandle, payload: serde_json::Value) {
    let id = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone();
    event_for(app, payload, id.as_deref());
}
struct ProcessTree(u32);
impl Drop for ProcessTree {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &self.0.to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .output();
        }
    }
}

#[tauri::command]
pub fn cancel_job(job_id: String) -> Result<(), String> {
    let current = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
    if current.as_deref() == Some(&job_id) {
        CANCEL.store(true, Ordering::SeqCst);
    }
    Ok(())
}

pub async fn run(
    app: &AppHandle,
    program: &Path,
    args: &[String],
) -> Result<serde_json::Value, String> {
    if cancelled() {
        return Err("已取消".into());
    }
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("OMP_NUM_THREADS", "2")
        .env("TOKENIZERS_PARALLELISM", "false")
        .env("HF_HUB_DISABLE_TELEMETRY", "1")
        .env("VOVO_HOME", app_support_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000200);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动本地任务：{e}"))?;
    let tree = ProcessTree(child.id().ok_or("无法取得本地进程编号")?);
    let source = CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let output_source = source.clone();
    let stdout = child.stdout.take().ok_or("无法读取任务输出")?;
    let stderr = child.stderr.take().ok_or("无法读取任务日志")?;
    let a = app.clone();
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut done = serde_json::json!({});
        let mut error = None;
        while let Ok(Some(line)) = lines.next_line().await {
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(value) => {
                    if value["type"] == "done" {
                        done = value.clone();
                    }
                    if value["type"] == "error" {
                        error = value["message"].as_str().map(str::to_owned);
                    }
                    event_for(&a, value, output_source.as_deref());
                }
                Err(_) => event_for(
                    &a,
                    serde_json::json!({"type":"log","message":line}),
                    output_source.as_deref(),
                ),
            }
        }
        (done, error)
    });
    let a = app.clone();
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut tail = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                tail = line.clone();
            }
            event_for(
                &a,
                serde_json::json!({"type":"log","message":line}),
                source.as_deref(),
            );
        }
        tail
    });
    let status = loop {
        if cancelled() {
            // 保留守卫，异常退出或超时也会清理整棵进程树。
            #[cfg(unix)]
            unsafe {
                libc::kill(-(tree.0 as i32), libc::SIGKILL);
            }
            #[cfg(target_os = "windows")]
            {
                let _ = tokio::process::Command::new("taskkill")
                    .args(["/PID", &tree.0.to_string(), "/T", "/F"])
                    .output()
                    .await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
            Err(error) => {
                out_task.abort();
                err_task.abort();
                return Err(error.to_string());
            }
        }
    };
    drop(tree);
    let (done, error) = out_task.await.map_err(|e| e.to_string())?;
    let tail = err_task.await.map_err(|e| e.to_string())?;
    match status {
        None => Err("已取消，文稿和已完成记录仍保留".into()),
        Some(status) if status.success() && error.is_none() => Ok(done),
        _ => Err(error.unwrap_or_else(|| {
            if tail.is_empty() {
                "本地任务失败，请查看设置中的诊断详情".into()
            } else {
                tail
            }
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn dropping_task_guard_terminates_descendants() {
        use std::os::unix::process::CommandExt;
        let pid_file = std::env::temp_dir().join(format!("vs-child-{}", studio::unique_id()));
        let mut child = std::process::Command::new("/bin/sh")
            .args([
                "-c",
                "sleep 30 & echo $! > \"$1\"; wait",
                "test",
                pid_file.to_str().unwrap(),
            ])
            .process_group(0)
            .spawn()
            .unwrap();
        let guard = ProcessTree(child.id());
        for _ in 0..100 {
            if pid_file.is_file() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let pid = std::fs::read_to_string(&pid_file).unwrap();
        drop(guard);
        child.wait().unwrap();
        let _ = std::fs::remove_file(pid_file);
        let output = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", pid.trim()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&output.stdout);
        assert!(
            state.trim().is_empty() || state.trim().starts_with('Z'),
            "子进程仍在运行：{state}"
        );
    }
    #[test]
    fn lock_and_cancel_are_scoped_to_job() {
        let job = Job::start("job-one").unwrap();
        assert!(Job::start("job-two").is_err());
        cancel_job("job-two".into()).unwrap();
        assert!(!cancelled());
        cancel_job("job-one".into()).unwrap();
        assert!(cancelled());
        drop(job);
        let _next = Job::start("job-two").unwrap();
        assert!(!cancelled());
    }
}
