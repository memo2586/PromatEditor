use crate::{service::Shared, storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub directory: String,
    pub python: String,
    pub extra_args: String,
    pub port: u16,
    pub lan: bool,
    pub open_console: bool,
    pub web_open_mode: String,
    pub web_url: String,
    pub open_web_on_start: bool,
    pub auto_scroll: bool,
    pub wrap: bool,
    pub log_limit: usize,
    pub auto_start: bool,
    pub exit_policy: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            directory: String::new(),
            python: String::new(),
            extra_args: String::new(),
            port: 8188, lan: true, open_console: true, auto_scroll: true,
            web_open_mode: "tab".into(), web_url: String::new(), open_web_on_start: false,
            wrap: false, log_limit: 5000, auto_start: false, exit_policy: "ask".into(),
        }
    }
}

/// Quoting is for argv only: never interpreted by cmd/PowerShell.
fn arguments(input: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut word = String::new();
    let mut quoted = false;
    let mut present = false;
    for c in input.chars() {
        if c == '"' {
            quoted = !quoted;
            present = true;
        } else if c.is_whitespace() && !quoted {
            if present {
                args.push(std::mem::take(&mut word));
                present = false;
            }
        } else {
            word.push(c);
            present = true;
        }
    }
    if quoted {
        return Err("附加启动参数中的双引号未闭合".into());
    }
    if present {
        args.push(word);
    }
    if args.iter().any(|s| {
        ["--port", "--listen", "--auto-launch"]
            .iter()
            .any(|k| s == k || s.starts_with(&format!("{}=", k)))
    }) {
        return Err("请用端口和局域网设置调整 --port / --listen；不支持自动打开浏览器".into());
    }
    Ok(args)
}
impl Config {
    fn validate(&self, paths: bool) -> Result<(), String> {
        if !["tab", "browser"].contains(&self.web_open_mode.as_str()) {
            return Err("ComfyUI 网页打开方式无效".into());
        }
        if !self.web_url.trim().is_empty() {
            let url = reqwest::Url::parse(self.web_url.trim()).map_err(|_| "请输入有效的 ComfyUI 网页地址")?;
            if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
                return Err("ComfyUI 网页地址须为 http:// 或 https:// 地址".into());
            }
        }
        if self.port == 0 {
            return Err("端口必须为 1–65535".into());
        }
        if !(100..=50000).contains(&self.log_limit) {
            return Err("日志保留上限必须为 100–50000 行".into());
        }
        if !["ask", "keep", "stop"].contains(&self.exit_policy.as_str()) {
            return Err("关闭编辑器的行为无效".into());
        }
        arguments(&self.extra_args)?;
        if self.directory.trim().is_empty() || self.python.trim().is_empty() {
            return Err("请选择 ComfyUI 目录和 Python 可执行文件".into());
        }
        if paths {
            if !Path::new(&self.directory).join("main.py").is_file() {
                return Err("ComfyUI 目录中找不到 main.py".into());
            }
            if !Path::new(&self.python).is_file() {
                return Err("Python 可执行文件不存在".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Session {
    id: String,
    token: String,
    pid: u32,
    started: u64,
    port: u16,
}
pub struct Manager {
    root: PathBuf,
    config: Config,
    config_error: Option<String>,
    session: Option<Session>,
    child: Option<Child>,
    cleared: u64,
    stop_at: Option<u64>,
    start_error: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn http() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(600))
        .build()
        .expect("HTTP client")
}
fn serving(port: u16) -> bool {
    http()
        .get(format!("http://127.0.0.1:{}/system_stats", port))
        .send()
        .is_ok_and(|r| r.status().is_success())
}
#[cfg(windows)]
fn alive(pid: u32) -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn GetExitCodeProcess(h: *mut std::ffi::c_void, code: *mut u32) -> i32;
        fn CloseHandle(h: *mut std::ffi::c_void) -> i32;
    }
    unsafe {
        let h = OpenProcess(0x1000, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut c = 0;
        let ok = GetExitCodeProcess(h, &mut c) != 0;
        CloseHandle(h);
        ok && c == 259
    }
}
#[cfg(not(windows))]
fn alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{}", pid)).exists()
}

impl Manager {
    pub fn new(directory: &Path) -> Self {
        let file = directory.join("comfy-process.json");
        let (config, config_error) = match fs::read(&file) {
            Ok(bytes) => match serde_json::from_slice::<Config>(&bytes) {
                Ok(c) => match c.validate(false) {
                    Ok(()) => (c, None),
                    Err(e) => (
                        Config::default(),
                        Some(format!("ComfyUI 配置无效，原文件已保留：{}", e)),
                    ),
                },
                Err(e) => (
                    Config::default(),
                    Some(format!("ComfyUI 配置读取失败，原文件已保留：{}", e)),
                ),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Config::default(), None),
            Err(e) => (
                Config::default(),
                Some(format!("无法读取 ComfyUI 配置：{}", e)),
            ),
        };
        let root = fs::canonicalize(directory)
            .unwrap_or_else(|_| directory.to_path_buf())
            .join("comfy-process");
        let session = fs::read(root.join("active.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        Self {
            root,
            config,
            config_error,
            session,
            child: None,
            cleared: 0,
            stop_at: None,
            start_error: None,
        }
    }
    fn session_dir(&self) -> Option<PathBuf> {
        self.session.as_ref().map(|s| self.root.join(&s.id))
    }
    fn control(&self, action: &str) -> Result<Value, String> {
        let s = self.session.as_ref().ok_or("没有由编辑器启动的进程")?;
        let dir = self.session_dir().unwrap();
        let v: Value = serde_json::from_slice(
            &fs::read(dir.join("control.json")).map_err(|_| "进程管理通道尚未就绪")?,
        )
        .map_err(|e| e.to_string())?;
        let port = v["port"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 65535)
            .ok_or("无效的管理端口")?;
        let client = http();
        let url = format!("http://127.0.0.1:{}{}", port, action);
        let req = if action == "/state" {
            client.get(url)
        } else {
            client.post(url)
        };
        let result: Value = req
            .bearer_auth(&s.token)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.json())
            .map_err(|e| format!("无法联系本次进程：{}", e))?;
        if result["pid"].as_u64() != Some(s.pid as u64) {
            return Err("进程身份不匹配，已拒绝操作".into());
        }
        Ok(result)
    }
    fn status(&mut self, revision: &str, logs: bool) -> Result<Value, String> {
        if let Some(child) = &mut self.child {
            let _ = child.try_wait();
        }
        let mut status = "stopped";
        let mut owned = false;
        let mut message = self
            .start_error
            .clone()
            .or(self.config_error.clone())
            .unwrap_or_default();
        let mut exit_code = None;
        if let Some(s) = &self.session {
            let dir = self.session_dir().unwrap();
            let exit: Option<Value> = fs::read(dir.join("exit.json"))
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok());
            if let Some(exit) = exit {
                exit_code = exit["code"].as_i64();
                if exit_code != Some(0) && exit["stopped"] != true {
                    status = "failed";
                    message = format!("ComfyUI 已退出 · code {}", exit_code.unwrap_or(1));
                }
            } else if alive(s.pid) {
                owned = true;
                match self.control("/state") {
                    Ok(v) if v["stopping"] == true => {
                        status = "stopping";
                        if self.stop_at.is_none() {
                            self.stop_at = Some(now())
                        }
                    }
                    Ok(_) => {
                        status = if serving(s.port) {
                            "running"
                        } else {
                            "starting"
                        };
                    }
                    Err(e) => {
                        status = "starting";
                        if now().saturating_sub(s.started) > 15 {
                            message = e;
                        }
                    }
                }
            } else {
                status = "failed";
                message = "ComfyUI 进程已退出，请查看最后的日志".into();
            }
        }
        if !owned && serving(self.config.port) {
            status = "external";
            message = "服务由外部启动，无法读取其控制台输出".into();
        }
        if self.start_error.is_some() && !owned && status != "external" {
            status = "failed";
        }
        let mut out = json!({"status":status,"owned":owned,"message":message,"pid":if owned{self.session.as_ref().map(|s|s.pid)}else{None},"started":self.session.as_ref().map(|s|s.started),"port":if owned{self.session.as_ref().map(|s|s.port).unwrap_or(self.config.port)}else{self.config.port},"elapsed":self.session.as_ref().map(|s|now().saturating_sub(s.started)).unwrap_or(0),"canForce":status=="stopping"&&self.stop_at.is_some_and(|t|now().saturating_sub(t)>=10),"exitCode":exit_code});
        if logs && status == "external" {
            out["revision"] = json!("external");
            out["lines"] = json!([]);
            return Ok(out);
        }
        if logs {
            let path = self.session_dir().map(|d| d.join("output.log"));
            let metadata = path.as_ref().and_then(|p| fs::metadata(p).ok());
            let bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            if bytes < self.cleared {
                self.cleared = 0;
            }
            let rev = format!(
                "{}:{}:{}:{}:{}",
                self.session.as_ref().map(|s| s.id.as_str()).unwrap_or(""),
                bytes,
                self.cleared,
                modified,
                self.config.log_limit
            );
            out["revision"] = json!(rev);
            if rev != revision {
                let mut data = Vec::new();
                if let Some(path) = path {
                    if let Ok(mut f) = fs::File::open(path) {
                        let offset = self.cleared.max(bytes.saturating_sub(2 * 1024 * 1024));
                        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
                        f.take(2 * 1024 * 1024)
                            .read_to_end(&mut data)
                            .map_err(|e| e.to_string())?;
                    }
                }
                let lines = render_log(&String::from_utf8_lossy(&data), self.config.log_limit);
                out["lines"] = json!(lines);
            }
        }
        Ok(out)
    }
    fn start(&mut self) -> Result<Value, String> {
        if let Some(error) = &self.config_error {
            return Err(format!("{}；请在设置中修复后再启动", error));
        }
        self.config.validate(true)?;
        let state = self.status("", false)?;
        if state["owned"] == true {
            return Err("ComfyUI 已在启动或运行，请勿重复启动".into());
        }
        if state["status"] == "external" {
            return Err("检测到外部 ComfyUI，请使用现有服务".into());
        }
        // Also reject a port occupied by a non-ComfyUI service.
        if std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", self.config.port).parse().unwrap(),
            Duration::from_millis(200),
        )
        .is_ok()
        {
            return Err("本机服务端口已被占用".into());
        }
        let old = self.session_dir();
        let id = uuid::Uuid::new_v4().to_string();
        let dir = self.root.join(&id);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let token = uuid::Uuid::new_v4().to_string();
        let mut args = arguments(&self.config.extra_args)?;
        args.extend([
            "--disable-auto-launch".into(),
            "--listen".into(),
            if self.config.lan {
                "0.0.0.0"
            } else {
                "127.0.0.1"
            }
            .into(),
            "--port".into(),
            self.config.port.to_string(),
        ]);
        storage::write(
            &dir.join("launch.json"),
            &json!({"token":token,"directory":self.config.directory,"args":args}),
        )?;
        fs::write(
            dir.join("supervisor.py"),
            include_str!("comfy_supervisor.py"),
        )
        .map_err(|e| e.to_string())?;
        let output = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("output.log"))
            .map_err(|e| e.to_string())?;
        let base = Path::new(&self.config.directory)
            .parent()
            .unwrap_or(Path::new(&self.config.directory));
        let mut cmd = Command::new(&self.config.python);
        cmd.args(["-s", "-u"])
            .arg(dir.join("supervisor.py"))
            .arg(&dir)
            .current_dir(base)
            .stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(output)
            .env("PYTHONUNBUFFERED", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("YOLO_CONFIG_DIR", base.join("_ultralytics"))
            .env("LORA_MANAGER_SETTINGS_DIR", base.join("_loramanager"))
            .env("XDG_DATA_HOME", base.join("_argos/data"))
            .env("XDG_CONFIG_HOME", base.join("_argos/config"))
            .env("XDG_CACHE_HOME", base.join("_argos/cache"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000);
        }
        let mut child = cmd.spawn().map_err(|e| format!("无法启动 Python：{}", e))?;
        let session = Session {
            id,
            token,
            pid: child.id(),
            started: now(),
            port: self.config.port,
        };
        if let Err(e) = storage::write(&self.root.join("active.json"), &session) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
        self.session = Some(session);
        self.child = Some(child);
        self.cleared = 0;
        self.stop_at = None;
        self.start_error = None;
        if let Some(old) = old {
            // Only a previous UUID session under our dedicated directory.
            if old.parent() == Some(self.root.as_path()) {
                let _ = fs::remove_dir_all(old);
            }
        }
        self.status("", true)
    }
}

fn render_log(input: &str, limit: usize) -> Vec<String> {
    let clean = regex::Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]")
        .unwrap()
        .replace_all(input, "");
    let normalized = clean.replace("\r\n", "\n");
    let mut lines: Vec<String> = normalized
        .split('\n')
        .map(|l| l.rsplit('\r').next().unwrap_or("").to_string())
        .collect();
    if lines.last().is_some_and(|s| s.is_empty()) {
        lines.pop();
    }
    if lines.len() > limit {
        lines.drain(..lines.len() - limit);
    }
    lines
}

pub fn dispatch(shared: &Shared, method: &str, p: Value) -> Result<Value, String> {
    let (manager, url) = {
        let s = shared.lock().map_err(|_| "编辑器状态不可用")?;
        (s.process.clone(), s.comfy_url.clone())
    };
    let mut m = manager.lock().map_err(|_| "进程管理状态不可用")?;
    match method {
        "process.config" => Ok(json!({"config":m.config,"url":url,"error":m.config_error})),
        "process.save" => {
            let next: Config =
                serde_json::from_value(p["config"].clone()).map_err(|e| e.to_string())?;
            // Preferences can be saved on a machine without this portable install.
            next.validate(false)?;
            if next.directory != m.config.directory || next.python != m.config.python {
                next.validate(true)?;
            }
            let url =
                crate::service::AppState::validate_comfy_url(p["url"].as_str().unwrap_or(&url))?;
            let mut s = shared.lock().map_err(|_| "编辑器状态不可用")?;
            let config_path = s.directory.join("comfy-process.json");
            if s.blocked.contains("comfy-connection.json") {
                storage::backup(&s.directory.join("comfy-connection.json"))?;
            }
            if m.config_error.is_some() {
                storage::backup(&config_path)?;
            }
            storage::write(&config_path, &next)?;
            if let Err(e) = storage::write(
                &s.directory.join("comfy-connection.json"),
                &json!({"url":url}),
            ) {
                let _ = storage::write(&config_path, &m.config);
                return Err(e);
            }
            m.config = next;
            m.config_error = None;
            if s.comfy_url != url {
                s.model_catalog = json!({});
                s.catalog = json!({});
                s.comfy_connected = false;
            }
            s.blocked.remove("comfy-connection.json");
            s.comfy_url = url.clone();
            s.comfy_error = None;
            Ok(json!({"config":m.config,"url":url}))
        }
        "process.preferences" => {
            let mut next = m.config.clone();
            if let Some(v) = p["wrap"].as_bool() {
                next.wrap = v;
            }
            if let Some(v) = p["autoScroll"].as_bool() {
                next.auto_scroll = v;
            }
            let directory = {
                shared
                    .lock()
                    .map_err(|_| "编辑器状态不可用")?
                    .directory
                    .clone()
            };
            if m.config_error.is_some() {
                return Err("请先在设置中修复 ComfyUI 配置".into());
            }
            storage::write(&directory.join("comfy-process.json"), &next)?;
            m.config = next;
            Ok(json!(m.config))
        }
        "process.poll" => m.status(
            p["revision"].as_str().unwrap_or(""),
            p["logs"].as_bool().unwrap_or(true),
        ),
        "process.start" => match m.start() {
            Ok(v) => Ok(v),
            Err(e) => {
                m.start_error = Some(e.clone());
                Err(e)
            }
        },
        "process.stop" => {
            if p["confirmed"] != true {
                return Err("停止服务需要确认".into());
            }
            let force = p["force"] == true;
            if force && (m.status("", false)?["canForce"] != true) {
                return Err("请先请求正常停止并等待 10 秒".into());
            }
            m.control(if force { "/force" } else { "/stop" })?;
            m.stop_at = Some(now());
            m.status("", true)
        }
        "process.clear" => {
            m.cleared = m
                .session_dir()
                .and_then(|d| fs::metadata(d.join("output.log")).ok())
                .map(|v| v.len())
                .unwrap_or(0);
            m.status("", true)
        }
        "process.test" => {
            let url =
                crate::service::AppState::validate_comfy_url(p["url"].as_str().unwrap_or(&url))?;
            let r = http()
                .get(format!("{}/system_stats", url.trim_end_matches('/')))
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("连接失败：{}", e))?;
            let _: Value = r
                .json()
                .map_err(|e| format!("不是有效的 ComfyUI 响应：{}", e))?;
            Ok(json!({"ok":true}))
        }
        _ => Err("未知的进程操作".into()),
    }
}

pub fn migrate(shared: &Shared, payload: Value) -> Result<Value, String> {
    let manager = shared
        .lock()
        .map_err(|_| "编辑器状态不可用")?
        .process
        .clone();
    let m = manager.lock().map_err(|_| "进程管理状态不可用")?;
    if m.session.as_ref().is_some_and(|s| alive(s.pid))
        && m.session_dir()
            .is_some_and(|d| !d.join("exit.json").exists())
    {
        return Err("请先停止由编辑器启动的 ComfyUI，再迁移数据目录".into());
    }
    let mut s = shared.lock().map_err(|_| "编辑器状态不可用")?;
    let result = s.rpc("data.migrate", payload)?;
    s.process = std::sync::Arc::new(std::sync::Mutex::new(Manager::new(&s.directory)));
    Ok(result)
}
