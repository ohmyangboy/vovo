//! 旧品牌只用于识别已有数据；新安装统一使用 vovo。
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
const LEGACY_MARKER: &str = ".vovo-legacy-path";

fn link_legacy(current: &Path, legacy: &Path) -> io::Result<()> {
    #[cfg(unix)]
    return std::os::unix::fs::symlink(current, legacy);
    #[cfg(windows)]
    return std::os::windows::fs::symlink_dir(current, legacy);
}

/// 整个目录在同一磁盘改名，保留旧路径入口，兼容虚拟环境和记录中的绝对路径。
pub fn migrate_data(parent: &Path) -> io::Result<PathBuf> {
    let legacy = parent.join("VoiceStudio");
    let current = parent.join("vovo");
    match fs::symlink_metadata(&legacy) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir_all(&current)?;
            // 上次恰好在目录改名后中断，也能修复旧绝对路径入口。
            if current.join(LEGACY_MARKER).is_file() {
                link_legacy(&current, &legacy)?;
            }
            return Ok(current);
        }
        Err(error) => return Err(error),
        Ok(_) => {}
    }
    if current.exists() {
        if legacy.canonicalize()? == current.canonicalize()? {
            return Ok(current);
        }
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "发现两份独立的应用数据，已保留全部文件，请先合并 VoiceStudio 与 vovo 目录",
        ));
    }
    if !fs::symlink_metadata(&legacy)?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "旧应用数据目录不可迁移",
        ));
    }
    fs::write(legacy.join(LEGACY_MARKER), b"VoiceStudio\n")?;
    fs::rename(&legacy, &current)?;
    if let Err(_error) = link_legacy(&current, &legacy) {
        fs::rename(&current, &legacy)?;
        // Windows 未启用符号链接权限时继续复用原环境，不破坏绝对路径。
        #[cfg(windows)]
        return Ok(legacy);
        #[cfg(not(windows))]
        return Err(_error);
    }
    Ok(current)
}

/// 在 WebView 创建前复制持久存储，包括 WebKit 的 salt；保留原副本以便回退。
pub fn migrate_webview(parent: &Path) -> io::Result<()> {
    let legacy = parent.join("local.voicestudio");
    let current = parent.join("local.vovo");
    if !legacy.is_dir() || current.exists() {
        return Ok(());
    }
    let staging = parent.join(format!(".vovo-storage-{}", std::process::id()));
    fs::create_dir(&staging)?;
    let result = copy_directory(&legacy, &staging).and_then(|()| fs::rename(&staging, &current));
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_directory(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "旧应用存储包含不支持的文件类型",
            ));
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "vovo-migration-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temporary {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn moves_data_once_and_keeps_old_absolute_paths() {
        use std::os::unix::fs::MetadataExt;
        let root = Temporary::new();
        let old = root.0.join("VoiceStudio");
        fs::create_dir_all(old.join("runtime/venv")).unwrap();
        fs::write(old.join("runtime/venv/model"), b"existing data").unwrap();
        let inode = fs::metadata(old.join("runtime/venv/model")).unwrap().ino();
        let new = migrate_data(&root.0).unwrap();
        assert_eq!(
            fs::metadata(new.join("runtime/venv/model")).unwrap().ino(),
            inode
        );
        assert_eq!(
            fs::read(old.join("runtime/venv/model")).unwrap(),
            b"existing data"
        );
        assert!(fs::symlink_metadata(&old).unwrap().file_type().is_symlink());
        assert_eq!(migrate_data(&root.0).unwrap(), new);
    }
    #[test]
    fn fresh_install_uses_vovo() {
        let root = Temporary::new();
        assert_eq!(migrate_data(&root.0).unwrap(), root.0.join("vovo"));
        assert!(!root.0.join("VoiceStudio").exists());
    }
    #[test]
    fn interrupted_rename_repairs_the_legacy_link() {
        let root = Temporary::new();
        let current = root.0.join("vovo");
        fs::create_dir(&current).unwrap();
        fs::write(current.join(LEGACY_MARKER), b"VoiceStudio\n").unwrap();
        fs::write(current.join("saved-voice"), b"audio").unwrap();
        assert_eq!(migrate_data(&root.0).unwrap(), current);
        assert_eq!(
            fs::read(root.0.join("VoiceStudio/saved-voice")).unwrap(),
            b"audio"
        );
    }
    #[test]
    fn independent_data_directories_are_not_overwritten() {
        let root = Temporary::new();
        for name in ["VoiceStudio", "vovo"] {
            fs::create_dir(root.0.join(name)).unwrap();
            fs::write(root.0.join(name).join("model"), name).unwrap();
        }
        assert!(migrate_data(&root.0).is_err());
        for name in ["VoiceStudio", "vovo"] {
            assert_eq!(
                fs::read_to_string(root.0.join(name).join("model")).unwrap(),
                name
            );
        }
    }
    #[test]
    fn webview_storage_is_copied_without_overwriting_new_settings() {
        let root = Temporary::new();
        let old = root.0.join("local.voicestudio/WebsiteData/Default");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("salt"), b"salt and settings").unwrap();
        migrate_webview(&root.0).unwrap();
        let new = root.0.join("local.vovo/WebsiteData/Default/salt");
        assert_eq!(fs::read(&new).unwrap(), b"salt and settings");
        fs::write(&new, b"new settings").unwrap();
        migrate_webview(&root.0).unwrap();
        assert_eq!(fs::read(&new).unwrap(), b"new settings");
        assert_eq!(fs::read(old.join("salt")).unwrap(), b"salt and settings");
    }
    #[test]
    fn failed_webview_copy_leaves_no_partial_destination() {
        let root = Temporary::new();
        let old = root.0.join("local.voicestudio");
        fs::create_dir(&old).unwrap();
        std::os::unix::fs::symlink("missing", old.join("unsupported")).unwrap();
        assert!(migrate_webview(&root.0).is_err());
        assert!(!root.0.join("local.vovo").exists());
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
    }
}
