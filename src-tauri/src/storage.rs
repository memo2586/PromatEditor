use serde::{de::DeserializeOwned, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
static VERIFIED_DIRS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
#[cfg(target_os = "windows")]
fn repair_windows_acl(path: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let sys_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let target = path.as_os_str();
    let _ = std::process::Command::new("icacls")
        .current_dir(&sys_root)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            target,
            std::ffi::OsStr::new("/inheritance:d"),
            std::ffi::OsStr::new("/C"),
            std::ffi::OsStr::new("/Q"),
        ])
        .status();
    let _ = std::process::Command::new("icacls")
        .current_dir(&sys_root)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            target,
            std::ffi::OsStr::new("/remove:d"),
            std::ffi::OsStr::new("*S-1-1-0"),
            std::ffi::OsStr::new("/remove:d"),
            std::ffi::OsStr::new("Everyone"),
            std::ffi::OsStr::new("/grant"),
            std::ffi::OsStr::new("*S-1-5-11:(OI)(CI)(F)"),
            std::ffi::OsStr::new("/setintegritylevel"),
            std::ffi::OsStr::new("(OI)(CI)M"),
            std::ffi::OsStr::new("/T"),
            std::ffi::OsStr::new("/C"),
            std::ffi::OsStr::new("/Q"),
        ])
        .status();
}
fn dir_is_healthy(path: &Path) -> bool {
    if !fs::metadata(path).is_ok_and(|m| m.is_dir()) {
        return false;
    }
    let probe = path.join(format!(".acl-{}.tmp", crate::model::id()));
    let ok = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .and_then(|mut f| f.write_all(b"ok"))
        .is_ok();
    let removed = fs::remove_file(&probe).is_ok();
    ok && removed
}
pub fn ensure_dir(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Ok(());
    }
    let cache = VERIFIED_DIRS.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(guard) = cache.lock() {
        if guard.contains(path) && fs::metadata(path).is_ok_and(|m| m.is_dir()) {
            return Ok(());
        }
    }
    if let Err(e) = fs::create_dir(path) {
        if e.kind() == std::io::ErrorKind::NotFound {
            if let Some(parent) = path.parent() {
                ensure_dir(parent)?;
            }
            let _ = fs::create_dir(path);
        }
    }
    if !dir_is_healthy(path) {
        #[cfg(target_os = "windows")]
        {
            let _ = fs::create_dir(path);
            repair_windows_acl(path);
        }
        let _ = fs::create_dir_all(path);
    }
    if !fs::metadata(path).is_ok_and(|m| m.is_dir()) {
        return Err(format!("无法访问或创建目录：{}", path.display()));
    }
    if let Ok(mut guard) = cache.lock() {
        guard.insert(path.to_path_buf());
    }
    Ok(())
}
pub fn read<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}：{}", path.display(), e))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|e| e.to_string())?
        .trim_start_matches('\u{feff}');
    serde_json::from_str(text).map_err(|e| format!("{}：{}", path.display(), e))
}
pub fn atomic_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("无效保存路径")?;
    ensure_dir(parent)?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        crate::model::id()
    ));
    let result = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if temp.exists() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    atomic_bytes(path, &bytes)
}
pub fn backup(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let name = format!(
        "{}.backup-{}.json",
        path.file_name().unwrap().to_string_lossy(),
        chrono::Local::now().format("%Y%m%d-%H%M%S-%f")
    );
    let next = path.with_file_name(name);
    fs::copy(path, &next).map_err(|e| e.to_string())?;
    Ok(Some(next))
}
pub fn migrate_directory(source: &Path, dest: &Path) -> Result<(), String> {
    ensure_dir(source)?;
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    ensure_dir(dest)?;
    let dest = fs::canonicalize(dest).map_err(|e| e.to_string())?;
    if source == dest {
        return Ok(());
    }
    if dest.starts_with(&source) || source.starts_with(&dest) {
        return Err("目标数据目录不能与源目录相互包含".into());
    }
    let mut created = vec![];
    let result = (|| {
        for entry in walkdir::WalkDir::new(&source) {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().is_symlink() {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(&source)
                .map_err(|e| e.to_string())?;
            let to = dest.join(rel);
            if entry.file_type().is_dir() {
                ensure_dir(&to)?;
            } else {
                if to.exists() {
                    return Err(format!("目标目录已有文件：{}", to.display()));
                }
                let mut input = File::open(entry.path()).map_err(|e| e.to_string())?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&to)
                    .map_err(|e| e.to_string())?;
                created.push(to);
                std::io::copy(&mut input, &mut output)
                    .and_then(|_| output.sync_all())
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        for file in created {
            let _ = fs::remove_file(file);
        }
    }
    result
}

// A rollback journal makes prompt+parameter adoption one crash-safe local transaction.
// Journal removal is the commit point; startup finishes rollback before loading either file.
pub fn recover_adoption(directory: &Path) -> Result<(), String> {
    let journal = directory.join("adoption-rollback.json");
    if !journal.exists() {
        return Ok(());
    }
    let old: serde_json::Value = read(&journal)?;
    let backups = ["session.json", "generation.json"]
        .into_iter()
        .map(|name| {
            let value = old.get(name).ok_or("采用回滚日志不完整，原文件已保护")?;
            let bytes = if value.is_null() {
                None
            } else {
                Some(
                    serde_json::from_value::<Vec<u8>>(value.clone())
                        .map_err(|_| "采用回滚日志内容无效，原文件已保护")?,
                )
            };
            Ok((name, bytes))
        })
        .collect::<Result<Vec<_>, String>>()?;
    for (name, bytes) in backups {
        if let Some(bytes) = bytes {
            atomic_bytes(&directory.join(name), &bytes)?;
        } else {
            let path = directory.join(name);
            if path.is_file() {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}
pub fn write_adoption(
    directory: &Path,
    project: &crate::model::Project,
    generation: &crate::model::Generation,
) -> Result<(), String> {
    recover_adoption(directory)?;
    let mut old = serde_json::json!({});
    for name in ["session.json", "generation.json"] {
        let path = directory.join(name);
        old[name] = if path.exists() {
            serde_json::to_value(fs::read(&path).map_err(|e| e.to_string())?).unwrap()
        } else {
            serde_json::Value::Null
        };
    }
    let journal = directory.join("adoption-rollback.json");
    write(&journal, &old)?;
    let result = (|| {
        write(&directory.join("session.json"), project)?;
        write(&directory.join("generation.json"), generation)?;
        fs::remove_file(&journal).map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        recover_adoption(directory).map_err(|r| format!("{e}；恢复日志保留：{r}"))?;
        return Err(e);
    }
    Ok(())
}
