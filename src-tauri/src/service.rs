use crate::{
    editor::{self, Editor},
    image_import,
    library::{self, BuiltinLibrary, BuiltinPrompt, Lexicon, LoraAsset, LoraData},
    model::*,
    parser, png, storage,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
#[path = "comfy_link.rs"]
mod comfy_link;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Preset {
    pub name: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct ComfyConnection {
    url: String,
}
impl Default for ComfyConnection {
    fn default() -> Self {
        Self {
            url: "http://127.0.0.1:8188".into(),
        }
    }
}
pub struct AppState {
    pub process: Arc<Mutex<crate::comfy_process::Manager>>,
    pub editor: Editor,
    pub settings: Settings,
    pub generation: Generation,
    pub favorites: FavoriteLibrary,
    pub loras: LoraData,
    pub builtin: BuiltinLibrary,
    pub lexicon: Lexicon,
    pub directory: PathBuf,
    pub initial_directory: PathBuf,
    pub project_path: Option<String>,
    pub cover: Vec<u8>,
    pub cover_source: Option<String>,
    pub saved_project: String,
    saved_card_unavailable: bool,
    saved_parameters: BasicParameters,
    saved_cover: u32,
    cover_modified: bool,
    pub errors: Vec<String>,
    pub session_restore_error: Option<String>,
    pub blocked: HashSet<String>,
    pub generation_error: Option<String>,
    ui_generation_error: Option<String>,
    pub composing: bool,
    pub snapshots: HashMap<String, String>,
    pub last_read: Option<String>,
    pub bridge_error: Option<String>,
    pub bridge_port: u16,
    presets: Vec<Preset>,
    pub import_data: Option<image_import::ImportData>,
    pub pending_images: HashSet<String>,
    pub ui: Option<Arc<dyn Fn(&str, Value) -> Result<(), String> + Send + Sync>>,
    pub ui_ready: bool,
    pub prepare_ack: Option<(String, std::sync::mpsc::Sender<Result<(), String>>)>,
    pub comfy_url: String,
    pub comfy_connected: bool,
    pub comfy_error: Option<String>,
    pub model_catalog: Value,
    pub catalog: Value,
    link: comfy_link::LinkStore,
}
pub type Shared = Arc<Mutex<AppState>>;
fn get<'a>(p: &'a Value, k: &str) -> &'a str {
    p[k].as_str().unwrap_or("")
}
fn ids(p: &Value) -> Vec<String> {
    p["ids"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}
fn parse_value<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| e.to_string())
}
fn default_presets() -> Vec<Preset> {
    [
        (512, 512),
        (512, 768),
        (768, 512),
        (576, 1024),
        (768, 768),
        (1024, 576),
        (768, 1024),
        (1024, 768),
        (832, 1248),
        (1248, 832),
        (1024, 1024),
        (1024, 1536),
        (1536, 1024),
        (1152, 2048),
        (1536, 1536),
        (2048, 1152),
        (2048, 2048),
    ]
    .iter()
    .map(|(w, h)| Preset {
        name: String::new(),
        width: *w,
        height: *h,
    })
    .collect()
}
impl AppState {
    pub fn new(directory: PathBuf, bridge_port: u16) -> Result<Self, String> {
        storage::ensure_dir(&directory)?;
        let initial_directory = directory.clone();
        let pointer = directory.join("active-data-directory.txt");
        let directory = if pointer.exists() {
            PathBuf::from(
                std::fs::read_to_string(pointer)
                    .map_err(|e| e.to_string())?
                    .trim(),
            )
        } else {
            directory
        };
        storage::ensure_dir(&directory)?;
        storage::recover_adoption(&directory)?;
        let mut errors = vec![];
        let mut blocked = HashSet::new();
        fn load<T: serde::de::DeserializeOwned + Default>(
            dir: &Path,
            name: &str,
            errors: &mut Vec<String>,
            blocked: &mut HashSet<String>,
        ) -> T {
            let path = dir.join(name);
            if !path.exists() {
                return T::default();
            }
            match storage::read(&path) {
                Ok(v) => v,
                Err(e) => {
                    errors.push(e);
                    blocked.insert(name.into());
                    T::default()
                }
            }
        }
        let settings: Settings = load(&directory, "settings.json", &mut errors, &mut blocked);
        let connection: ComfyConnection = load(
            &directory,
            "comfy-connection.json",
            &mut errors,
            &mut blocked,
        );
        let comfy_url = match Self::validate_comfy_url(&connection.url) {
            Ok(url) => url,
            Err(e) => {
                errors.push(e);
                blocked.insert("comfy-connection.json".into());
                ComfyConnection::default().url
            }
        };
        let mut generation: Generation =
            load(&directory, "generation.json", &mut errors, &mut blocked);
        let generation_error = generation.validate().err();
        if let Some(e) = &generation_error {
            errors.push(e.clone());
            blocked.insert("generation.json".into());
            generation = Generation::default();
        }
        let mut favorites = FavoriteLibrary::default();
        let favpath = directory.join("favorites.json");
        if favpath.exists() {
            let result = (|| {
                let v: Value = storage::read(&favpath)?;
                let mut f: FavoriteLibrary = if v.is_array() {
                    FavoriteLibrary {
                        version: 3,
                        items: parse_value(v)?,
                    }
                } else {
                    parse_value(v)?
                };
                if ![2, 3].contains(&f.version) {
                    return Err("收藏版本不支持".into());
                }
                let mut ids = HashSet::new();
                for x in &mut f.items {
                    if x.id.is_empty() || !ids.insert(x.id.clone()) {
                        x.id = id();
                    }
                    if x.category.is_empty() {
                        x.category = "Extra".into()
                    }
                    if !CATEGORIES.contains(&x.category.as_str()) {
                        return Err("收藏类别无效".into());
                    }
                }
                f.version = 3;
                Ok(f)
            })();
            match result {
                Ok(f) => favorites = f,
                Err(e) => {
                    errors.push(e);
                    blocked.insert("favorites.json".into());
                }
            }
        }
        let loras: LoraData = load(&directory, "lora-library.json", &mut errors, &mut blocked);
        let mut link: comfy_link::LinkStore =
            load(&directory, "runs.json", &mut errors, &mut blocked);
        link.initialize_feedback();
        let loras = if let Err(e) = library::validate_loras(&loras) {
            errors.push(e);
            blocked.insert("lora-library.json".into());
            LoraData::default()
        } else {
            loras
        };
        let builtin = BuiltinLibrary::new(directory.join("builtin-prompts.user.json"))?;
        if let Some(e) = &builtin.error {
            errors.push(e.clone())
        }
        let mut editor = Editor::default();
        let mut session_restore_error = None;
        let sessionpath = directory.join("session.json");
        if sessionpath.exists() {
            match storage::read::<Project>(&sessionpath).and_then(|p| editor.load(p)) {
                Ok(_) => (),
                Err(e) => {
                    session_restore_error = Some(e.clone());
                    errors.push(e);
                    blocked.insert("session.json".into());
                }
            }
        }
        let lexicon = if settings.auto_load {
            settings
                .excel
                .as_ref()
                .filter(|s| !s.is_empty())
                .and_then(|p| match Lexicon::read(Path::new(p)) {
                    Ok(l) => Some(l),
                    Err(e) => {
                        errors.push(e);
                        None
                    }
                })
                .unwrap_or_default()
        } else {
            Lexicon::default()
        };
        let mut presets = default_presets();
        let custom: Vec<Preset> = load(&directory, "size-presets.json", &mut errors, &mut blocked);
        for p in custom {
            if p.width >= 16
                && p.height >= 16
                && p.width <= 16384
                && p.height <= 16384
                && p.width % 8 == 0
                && p.height % 8 == 0
                && !presets
                    .iter()
                    .any(|q| p.width == q.width && p.height == q.height)
            {
                presets.push(p)
            }
        }
        presets.sort_by_key(|p| (p.width as u64 * p.height as u64, p.width));
        let project_path: Option<String> =
            storage::read::<Value>(&directory.join("workspace.json"))
                .ok()
                .and_then(|v| v["projectPath"].as_str().map(str::to_string));
        let saved_card = if let Some(p) = &project_path {
            match png::read_image(Path::new(p)).and_then(|b| png::decode(&b)) {
                Ok(Some(card)) => Some(card),
                result => {
                    errors.push(format!(
                        "无法读取已保存的提示词卡 {}：{}；工作区已保留",
                        p,
                        result
                            .err()
                            .unwrap_or_else(|| "图片中没有提示词卡数据".into())
                    ));
                    None
                }
            }
        } else {
            None
        };
        let mut saved_card_unavailable = project_path.is_some() && saved_card.is_none();
        let saved_project = serde_json::to_string(
            &saved_card
                .as_ref()
                .map(|c| c.project.clone())
                .unwrap_or_default(),
        )
        .unwrap();
        let mut saved_generation = generation.clone();
        if let Some(parameters) = saved_card.as_ref().and_then(|c| c.parameters.as_ref()) {
            for key in parameters.values.keys() {
                if let Err(error) = parameters.apply(&mut saved_generation, key) {
                    errors.push(format!("无法读取提示词卡参数：{}；工作区已保留", error));
                    saved_card_unavailable = true;
                    break;
                }
            }
        }
        let saved_parameters = BasicParameters::from_generation(&saved_generation);
        let mut cover = include_bytes!("../../public/icon.png").to_vec();
        if let Some(p) = &project_path {
            if let Ok(b) = png::read_image(Path::new(p)) {
                cover = b
            }
        }
        let saved_cover = crc32fast::hash(&cover);
        Ok(Self {
            process: Arc::new(Mutex::new(crate::comfy_process::Manager::new(&directory))),
            editor,
            settings,
            generation,
            favorites,
            loras,
            builtin,
            lexicon,
            directory,
            initial_directory,
            project_path,
            cover,
            cover_source: None,
            saved_project,
            saved_card_unavailable,
            saved_parameters,
            saved_cover,
            cover_modified: false,
            errors,
            session_restore_error,
            blocked,
            generation_error,
            ui_generation_error: None,
            composing: false,
            snapshots: HashMap::new(),
            last_read: None,
            bridge_error: None,
            bridge_port,
            presets,
            import_data: None,
            pending_images: HashSet::new(),
            ui: None,
            ui_ready: false,
            prepare_ack: None,
            comfy_url,
            comfy_connected: false,
            comfy_error: None,
            model_catalog: json!({}),
            catalog: json!({}),
            link,
        })
    }
    fn persist<T: Serialize>(&self, name: &str, value: &T) -> Result<(), String> {
        if matches!(name, "session.json" | "generation.json") {
            storage::recover_adoption(&self.directory)?;
        }
        if self.blocked.contains(name) {
            return Err(format!(
                "{} 读取失败，原文件已保护；请先备份后修复或切换数据目录",
                name
            ));
        }
        storage::write(&self.directory.join(name), value)
    }
    fn persist_adoption(&self) -> Result<(), String> {
        if self.blocked.contains("session.json") || self.blocked.contains("generation.json") {
            return Err("原文件已保护，无法采用提示词与参数".into());
        }
        storage::write_adoption(&self.directory, &self.editor.project, &self.generation)
    }
    fn session(&self) -> Result<(), String> {
        self.persist("session.json", &self.editor.project)?;
        self.persist("workspace.json", &json!({"projectPath":self.project_path}))
    }
    fn save_editor_edit<T>(
        &mut self,
        edit: impl FnOnce(&mut Editor) -> Result<T, String>,
        changed: impl FnOnce(&T) -> bool,
    ) -> Result<T, String> {
        let old = self.editor.clone();
        let result = edit(&mut self.editor)?;
        if changed(&result) {
            if let Err(error) = self.persist("session.json", &self.editor.project) {
                self.editor = old;
                return Err(error);
            }
        }
        Ok(result)
    }
    fn dirty(&self) -> bool {
        let mut p = self.editor.project.clone();
        p.state.is_negative = false;
        p.state.positive.caret = 0;
        p.state.negative.caret = 0;
        p.state.positive.selection_end = None;
        p.state.negative.selection_end = None;
        p.state.positive.scroll = 0.;
        p.state.negative.scroll = 0.;
        let mut saved = serde_json::from_str::<Project>(&self.saved_project).unwrap_or_default();
        saved.state.is_negative = false;
        saved.state.positive.caret = 0;
        saved.state.negative.caret = 0;
        saved.state.positive.selection_end = None;
        saved.state.negative.selection_end = None;
        saved.state.positive.scroll = 0.;
        saved.state.negative.scroll = 0.;
        self.saved_card_unavailable
            || serde_json::to_string(&p).ok() != serde_json::to_string(&saved).ok()
            || BasicParameters::from_generation(&self.generation).values
                != self.saved_parameters.values
            || self.cover_modified
    }
    fn generation_problem(&self) -> Option<&str> {
        self.ui_generation_error
            .as_deref()
            .or(self.generation_error.as_deref())
    }
    fn state(&self) -> Value {
        let mut v = self.editor.status();
        let map = v.as_object_mut().unwrap();
        map.insert("settings".into(), json!(self.settings));
        map.insert("generation".into(), json!(self.generation));
        map.insert("projectPath".into(), json!(self.project_path));
        map.insert("dirty".into(), json!(self.dirty()));
        map.insert("dataDirectory".into(), json!(self.directory));
        map.insert("favorites".into(), json!(self.favorites.items));
        map.insert("presets".into(), json!(self.presets));
        map.insert("errors".into(), json!(self.errors));
        map.insert(
            "sessionRestoreError".into(),
            json!(self.session_restore_error),
        );
        map.insert("generationError".into(), json!(self.generation_problem()));
        map.insert(
            "bridge".into(),
            json!({"port":self.bridge_port,"lastRead":self.last_read,"error":self.bridge_error,
                "comfyUrl":self.comfy_url,"comfyConnected":self.comfy_connected,
                "workflowRead":!self.catalog["updated_at"].is_null() || !self.model_catalog["updated_at"].is_null(),
                "comfyError":self.comfy_error}),
        );
        map.insert("lexicon".into(),json!({"path":self.lexicon.path,"positive":self.lexicon.positive.len(),"negative":self.lexicon.negative.len(),"size":self.lexicon.size,"changed":self.lexicon.path.as_ref().and_then(|p|std::fs::metadata(p).ok()).is_some_and(|m|m.modified().ok()!=self.lexicon.modified||m.len()!=self.lexicon.size)}));
        let matches: HashMap<_, _> = self
            .editor
            .current()
            .active
            .iter()
            .chain(&self.editor.current().hidden)
            .filter_map(|t| {
                self.lexicon
                    .for_workspace(self.editor.project.state.is_negative)
                    .get(&t.key)
                    .map(|l| (t.id.clone(), l))
            })
            .collect();
        map.insert("matches".into(), json!(matches));
        v
    }
    fn history_add(&mut self, path: &str) -> Result<(), String> {
        self.settings
            .recent_projects
            .retain(|p| !p.eq_ignore_ascii_case(path));
        self.settings.recent_projects.insert(0, path.into());
        self.settings.recent_projects.truncate(20);
        self.persist("settings.json", &self.settings)
    }
    pub(crate) fn validate_comfy_url(url: &str) -> Result<String, String> {
        let u = reqwest::Url::parse(url.trim()).map_err(|e| e.to_string())?;
        if u.scheme() != "http"
            || !["127.0.0.1", "localhost"].contains(&u.host_str().unwrap_or(""))
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
        {
            return Err("仅支持本机 ComfyUI HTTP 地址".into());
        }
        Ok(u.as_str().trim_end_matches('/').into())
    }
    fn http_at(url: &str, path: &str) -> Result<Value, String> {
        let url = Self::validate_comfy_url(url)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let r = client
            .get(format!("{}{}", url, path))
            .send()
            .map_err(|e| format!("无法读取 ComfyUI：{}", e))?;
        let status = r.status();
        let v: Value = r.json().map_err(|e| e.to_string())?;
        if !status.is_success() || v["error"].is_string() {
            return Err(v["error"].as_str().unwrap_or("ComfyUI 请求失败").into());
        }
        Ok(v)
    }
    fn http(&self, path: &str) -> Result<Value, String> {
        Self::http_at(&self.comfy_url, path)
    }
    fn validate_catalog(catalog: Value) -> Result<Value, String> {
        if !catalog["groups"].is_array() || !catalog["samplers"].is_array() {
            return Err(
                "ComfyUI 响应缺少 Bridge 目录，请确认已安装并启用 Prompt Editor Bridge".into(),
            );
        }
        Ok(catalog)
    }
    fn read_catalog(&mut self, path: &str) -> Result<Value, String> {
        let result = self.http(path).and_then(|catalog| {
            if path == "/prompt-editor/catalog" {
                Self::validate_catalog(catalog)
            } else {
                Ok(catalog)
            }
        });
        match result {
            Ok(catalog) => {
                self.comfy_connected = true;
                self.comfy_error = None;
                Ok(catalog)
            }
            Err(error) => {
                self.comfy_connected = false;
                self.comfy_error = Some(error.clone());
                Err(error)
            }
        }
    }
    pub fn rpc(&mut self, method: &str, p: Value) -> Result<Value, String> {
        let mut save_session = false;
        match method {
            method if method.starts_with("runs.") => return self.link_rpc(method, p),
            "state.get" => return Ok(self.state()),
            "ui.ready" => self.ui_ready = true,
            "bridge.ready" => {
                if self
                    .prepare_ack
                    .as_ref()
                    .is_some_and(|(id, _)| id == get(&p, "id"))
                {
                    if let Some((_, sender)) = self.prepare_ack.take() {
                        let _ = sender.send(if let Some(error) = p["error"].as_str() {
                            Err(error.into())
                        } else {
                            Ok(())
                        });
                    }
                }
            }
            "editor.text" => {
                let selection = |key| {
                    p[key].as_array().and_then(|v| {
                        Some((v.first()?.as_u64()? as usize, v.get(1)?.as_u64()? as usize))
                    })
                };
                self.editor.set_source_text(
                    get(&p, "text").into(),
                    selection("before"),
                    selection("after"),
                    p["scroll"].as_f64(),
                )?;
                save_session = true
            }
            "editor.workspace" => {
                self.editor.project.state.is_negative = p["negative"].as_bool().unwrap_or(false);
                save_session = true
            }
            "editor.view" => {
                let w = self.editor.project.state.current_mut();
                let selection = p["caret"].as_u64().map(|start| {
                    (
                        start as usize,
                        p["selectionEnd"].as_u64().unwrap_or(start) as usize,
                    )
                });
                editor::set_source_view(w, selection, p["scroll"].as_f64());
                save_session = true
            }
            "editor.composition" => self.composing = p["active"].as_bool().unwrap_or(false),
            "editor.undo" | "editor.redo" => {
                let old = self.editor.clone();
                let old_generation = self.generation.clone();
                let generation = if method == "editor.undo" {
                    self.editor.undo_with_generation()
                } else {
                    self.editor.redo_with_generation()
                };
                if let Some(g) = generation {
                    self.generation = g;
                }
                let result = if self.generation != old_generation {
                    self.persist_adoption()
                } else {
                    self.persist("session.json", &self.editor.project)
                };
                if let Err(e) = result {
                    self.editor = old;
                    self.generation = old_generation;
                    return Err(e);
                }
                return Ok(self.state());
            }
            "editor.weight" => {
                let value = if p["value"].is_null() {
                    None
                } else {
                    Some(
                        parser::number(
                            &p["value"]
                                .as_str()
                                .map(str::to_string)
                                .unwrap_or(p["value"].to_string()),
                        )
                        .ok_or("权重必须是有限十进制数")?,
                    )
                };
                self.editor
                    .weight(&ids(&p), value, p["relative"].as_bool().unwrap_or(false))?;
                save_session = true
            }
            "editor.hide" => {
                self.editor.hide(&ids(&p))?;
                save_session = true
            }
            "editor.restore" => {
                self.editor.restore(&ids(&p))?;
                save_session = true
            }
            "editor.delete" => {
                self.editor.delete(&ids(&p))?;
                save_session = true
            }
            "editor.insert" => {
                self.editor.insert(
                    get(&p, "text"),
                    p["start"]
                        .as_u64()
                        .unwrap_or(self.editor.current().text.encode_utf16().count() as u64) as usize,
                    p["length"].as_u64().unwrap_or(0) as usize,
                    p["completion"].as_bool().unwrap_or(false),
                )?;
                save_session = true
            }
            "editor.natural.bind" => {
                let start = p["start"].as_u64().ok_or("请选择要绑定的原文")? as usize;
                let end = p["end"].as_u64().ok_or("请选择要绑定的原文")? as usize;
                let terms = ids(&p);
                self.save_editor_edit(
                    |editor| match editor.bind_natural(start, end) {
                        Err(_) if !terms.is_empty() => editor.bind_natural_terms(&terms),
                        result => result,
                    },
                    |_| true,
                )?;
            }
            "editor.term.edit" => {
                self.save_editor_edit(
                    |editor| editor.edit_term_text(get(&p, "id"), get(&p, "text")),
                    |_| true,
                )?;
            }
            "editor.group.append" => {
                self.save_editor_edit(
                    |editor| editor.append_group_term(get(&p, "id"), get(&p, "text")),
                    |_| true,
                )?;
            }
            "editor.natural.unbind" => {
                let at = p["start"].as_u64().ok_or("未找到自然语言提示词")? as usize;
                self.save_editor_edit(|editor| editor.unbind_natural(at), |_| true)?;
            }
            "editor.natural.edit" => {
                self.save_editor_edit(
                    |editor| editor.edit_natural(get(&p, "id"), get(&p, "text")),
                    |_| true,
                )?;
            }
            "editor.symbols.clean" => {
                let escape = match get(&p, "action") {
                    "commas" => false,
                    "escape" => true,
                    _ => return Err("未知符号整理操作".into()),
                };
                let changes = self.save_editor_edit(|editor| editor.clean_symbols(escape), |n| *n > 0)?;
                let mut state = self.state();
                state["changes"] = json!(changes);
                return Ok(state);
            }
            "editor.copy" => {
                self.editor.require_valid()?;
                return Ok(json!(editor::format_prompt(self.editor.current())));
            }
            "editor.group" => {
                self.editor.group(
                    &ids(&p),
                    get(&p, "name"),
                    get(&p, "category"),
                    get(&p, "description"),
                )?;
                save_session = true
            }
            "editor.group.edit" => {
                self.editor.edit_group(
                    get(&p, "id"),
                    get(&p, "name"),
                    get(&p, "category"),
                    get(&p, "description"),
                )?;
                save_session = true
            }
            "editor.group.dissolve" => {
                self.editor.dissolve(get(&p, "id"))?;
                save_session = true
            }
            "editor.group.delete" => {
                let ids = self
                    .editor
                    .current()
                    .groups
                    .iter()
                    .find(|g| g.id == get(&p, "id"))
                    .ok_or("组不存在")?
                    .members
                    .clone();
                self.editor.delete(&ids)?;
                save_session = true
            }
            "editor.detach" => {
                self.editor.detach(&ids(&p))?;
                save_session = true
            }
            "editor.move" => {
                self.editor.move_terms(
                    &ids(&p),
                    get(&p, "target"),
                    p["after"].as_bool().unwrap_or(false),
                    p["group"].as_str(),
                    p["block"].as_str(),
                )?;
                save_session = true
            }
            "editor.group.move" => {
                self.editor.move_group(
                    get(&p, "id"),
                    get(&p, "target"),
                    p["after"].as_bool().unwrap_or(false),
                )?;
                save_session = true
            }
            "project.new" => {
                self.editor.load(Project::default())?;
                self.project_path = None;
                self.cover = include_bytes!("../../public/icon.png").to_vec();
                self.cover_source = None;
                self.saved_project = serde_json::to_string(&self.editor.project).unwrap();
                self.saved_card_unavailable = false;
                self.saved_parameters = BasicParameters::from_generation(&self.generation);
                self.saved_cover = crc32fast::hash(&self.cover);
                self.cover_modified = false;
                save_session = true
            }
            "project.open" => {
                let path = Path::new(get(&p, "path"));
                if path
                    .extension()
                    .is_some_and(|s| s.eq_ignore_ascii_case("json"))
                {
                    let project = storage::read(path)?;
                    self.editor.load(project)?;
                    self.project_path = None;
                    self.cover = include_bytes!("../../public/icon.png").to_vec();
                } else {
                    let image = png::read_image(path)?;
                    let card = png::decode(&image)?.ok_or("图片不是提示词卡，请使用图片导入")?;
                    let mut generation = self.generation.clone();
                    if let Some(b) = &card.parameters {
                        for k in b.values.keys() {
                            b.apply(&mut generation, k)?
                        }
                        generation.validate()?;
                        self.persist("generation.json", &generation)?;
                    }
                    self.editor.load(card.project)?;
                    self.generation = generation;
                    self.cover = image;
                    self.project_path = Some(get(&p, "path").into());
                }
                self.cover_source = None;
                self.saved_project = serde_json::to_string(&self.editor.project).unwrap();
                self.saved_card_unavailable = false;
                self.saved_parameters = BasicParameters::from_generation(&self.generation);
                self.saved_cover = crc32fast::hash(&self.cover);
                self.cover_modified = false;
                self.history_add(get(&p, "path"))?;
                save_session = true
            }
            "project.save_check" => {
                let path = Path::new(get(&p, "path"));
                if path.exists() && png::decode(&png::read_image(path)?)?.is_none() {
                    return Err("不能覆盖非提示词卡图片，请选择其他名称".into());
                }
                return Ok(json!({"exists":path.exists()}));
            }
            "project.save" => {
                if let Some(error) = self.generation_problem() {
                    return Err(error.into());
                }
                let path = if get(&p, "path").is_empty() {
                    self.project_path.clone().ok_or("请选择保存位置")?
                } else {
                    get(&p, "path").into()
                };
                let cover = if let Some(base64) = p["coverBase64"].as_str() {
                    base64::engine::general_purpose::STANDARD
                        .decode(base64)
                        .map_err(|e| e.to_string())?
                } else if let Some(s) = p["coverPath"].as_str() {
                    png::read_image(Path::new(s))?
                } else if p["defaultCover"].as_bool().unwrap_or(false) {
                    include_bytes!("../../public/icon.png").to_vec()
                } else {
                    self.cover.clone()
                };
                let source = p["coverPath"].as_str().or(self.cover_source.as_deref());
                let current = if p["overwrite"].as_bool().unwrap_or(false) {
                    Some(Path::new(&path))
                } else if p["saveAs"].as_bool().unwrap_or(false) {
                    None
                } else {
                    self.project_path.as_deref().map(Path::new)
                };
                png::save(
                    Path::new(&path),
                    &cover,
                    &self.editor.project,
                    &self.generation,
                    source.map(Path::new),
                    current,
                )?;
                self.cover = cover;
                self.cover_source = None;
                self.project_path = Some(path.clone());
                self.saved_project = serde_json::to_string(&self.editor.project).unwrap();
                self.saved_card_unavailable = false;
                self.saved_parameters = BasicParameters::from_generation(&self.generation);
                self.saved_cover = crc32fast::hash(&self.cover);
                self.cover_modified = false;
                self.history_add(&path)?;
                save_session = true
            }
            "project.recent" => {
                return Ok(json!(self
                    .settings
                    .recent_projects
                    .iter()
                    .map(|p| json!({"path":p,"exists":Path::new(p).is_file()}))
                    .collect::<Vec<_>>()))
            }
            "image.inspect" => {
                let data = image_import::read(Path::new(get(&p, "path")))?;
                let output = serde_json::to_value(&data).unwrap();
                self.import_data = Some(data);
                return Ok(output);
            }
            "image.plan" => {
                let data = self.import_data.as_ref().ok_or("请先读取图片")?;
                let (_, _, overwrites) =
                    image_import::plan(data, &p, &self.editor.project, &self.generation)?;
                return Ok(json!(overwrites));
            }
            "image.apply" => {
                let data = self.import_data.as_ref().ok_or("请先读取图片")?;
                let (project, generation, _) =
                    image_import::plan(data, &p, &self.editor.project, &self.generation)?;
                self.persist("generation.json", &generation)?;
                self.editor.transact(|e| {
                    e.project = project;
                    Ok(())
                })?;
                self.generation = generation;
                self.cover = data.image.clone();
                self.cover_modified = crc32fast::hash(&self.cover) != self.saved_cover;
                self.cover_source = p["path"].as_str().map(str::to_string);
                save_session = true
            }
            "generation.set" => {
                let next: Generation = parse_value(p["value"].clone())?;
                if let Err(e) = next.validate() {
                    self.generation_error = Some(e.clone());
                    return Err(e);
                }
                if self.blocked.contains("generation.json") {
                    storage::backup(&self.directory.join("generation.json"))?;
                    self.blocked.remove("generation.json");
                }
                self.persist("generation.json", &next)?;
                self.generation = next;
                self.generation_error = None
            }
            "generation.invalid" => {
                self.ui_generation_error = p["error"]
                    .as_str()
                    .filter(|error| !error.is_empty())
                    .map(str::to_string)
            }
            "generation.random" => {
                let mut next = self.generation.clone();
                next.seed = rand::random::<u64>() & MAX_SEED;
                next.validate()?;
                self.persist("generation.json", &next)?;
                self.generation = next
            }
            "presets.add" => {
                let next: Preset = parse_value(p)?;
                let mut g = self.generation.clone();
                g.width = next.width;
                g.height = next.height;
                g.validate()?;
                if !self
                    .presets
                    .iter()
                    .any(|x| x.width == next.width && x.height == next.height)
                {
                    let mut presets = self.presets.clone();
                    presets.push(next);
                    presets.sort_by_key(|p| (p.width as u64 * p.height as u64, p.width));
                    self.persist("size-presets.json", &presets)?;
                    self.presets = presets;
                }
                self.persist("generation.json", &g)?;
                self.generation = g;
                self.generation_error = None;
            }
            "settings.set" => {
                let next: Settings = parse_value(p["value"].clone())?;
                if next.step <= rust_decimal::Decimal::ZERO
                    || next.step > 100.into()
                    || !(0.0..=1.0).contains(&next.background_opacity)
                    || !(0.0..=100.0).contains(&next.background_blur)
                {
                    return Err("设置数值无效".into());
                }
                self.persist("settings.json", &next)?;
                self.settings = next
            }
            "system.fonts" => {
                return Ok(json!(get_installed_fonts()));
            }
            "lexicon.load" => {
                let path = if get(&p, "path").is_empty() {
                    self.settings.excel.clone().ok_or("请选择 Excel 词库")?
                } else {
                    get(&p, "path").into()
                };
                let next = Lexicon::read(Path::new(&path))?;
                let mut settings = self.settings.clone();
                settings.excel = Some(path);
                self.persist("settings.json", &settings)?;
                self.settings = settings;
                self.lexicon = next
            }
            "lexicon.search" => {
                let text = get(&p, "text");
                let mut records =
                    self.lexicon
                        .search(text, self.editor.project.state.is_negative, 60);
                if !text.trim().is_empty() {
                    let key = text.to_lowercase();
                    let mut b: Vec<_> = self
                        .builtin
                        .entries
                        .iter()
                        .filter(|e| e.search.contains(&key))
                        .collect();
                    b.sort_by_key(|e| {
                        if e.text.eq_ignore_ascii_case(text) {
                            0
                        } else if e.text.to_lowercase().starts_with(&key) {
                            1
                        } else if e.name.to_lowercase().starts_with(&key) {
                            2
                        } else {
                            3
                        }
                    });
                    records.extend(b.into_iter().take(12).map(|e| library::Lexeme {
                        text: e.text.clone(),
                        key: parser::normalize(&e.text),
                        translation: e.name.clone(),
                        count: 0,
                        source: format!("内置 · {}", e.category),
                    }));
                }
                return Ok(json!(records));
            }
            "favorites.createSelection" => {
                if self.blocked.contains("favorites.json") {
                    return Err("收藏文件读取失败，原文件已保护".into());
                }
                let path = self.directory.join("favorites.json");
                let mut next = self.favorites.clone();
                self.editor.create_favorite(
                    &ids(&p),
                    get(&p, "name"),
                    get(&p, "category"),
                    |f| {
                        next.items.push(f.clone());
                        storage::write(&path, &next)
                    },
                )?;
                self.favorites = next;
                save_session = true;
            }
            "favorites.save" => {
                let mut f: Favorite = parse_value(p["value"].clone())?;
                if f.id.is_empty() {
                    f.id = id()
                }
                if f.name.trim().is_empty()
                    || f.text.trim().is_empty()
                    || !CATEGORIES.contains(&f.category.as_str())
                {
                    return Err("名称、分类与提示词不能为空".into());
                }
                if let Some(err) = parser::parse(&f.text, None).error {
                    return Err(err);
                }
                let mut next = self.favorites.clone();
                next.items.retain(|x| x.id != f.id);
                next.items.push(f);
                self.persist("favorites.json", &next)?;
                self.favorites = next
            }
            "favorites.delete" => {
                let mut next = self.favorites.clone();
                next.items.retain(|x| x.id != get(&p, "id"));
                self.persist("favorites.json", &next)?;
                self.favorites = next;
                self.clean_images()?
            }
            "favorites.insert" => {
                let f = self
                    .favorites
                    .items
                    .iter()
                    .find(|f| f.id == get(&p, "id"))
                    .ok_or("收藏不存在")?
                    .clone();
                if let Some(n) = p["negative"].as_bool() {
                    self.editor.project.state.is_negative = n
                }
                self.editor.insert_favorite(
                    &f,
                    p["start"]
                        .as_u64()
                        .unwrap_or(self.editor.current().text.encode_utf16().count() as u64) as usize,
                    p["length"].as_u64().unwrap_or(0) as usize,
                )?;
                save_session = true
            }
            "builtin.query" => return Ok(self.builtin.query(&p)),
            "builtin.detail" => {
                return self
                    .builtin
                    .entries
                    .iter()
                    .find(|e| e.id == get(&p, "id"))
                    .map(|e| json!(e))
                    .ok_or("词条不存在".into())
            }
            "builtin.save" => {
                let e: BuiltinPrompt = parse_value(p["value"].clone())?;
                self.builtin.save(e)?
            }
            "builtin.action" => self.builtin.action(get(&p, "action"), get(&p, "id"))?,
            "builtin.apply" => {
                let b = self
                    .builtin
                    .entries
                    .iter()
                    .find(|e| e.id == get(&p, "id"))
                    .ok_or("词条不存在")?
                    .clone();
                let text = match get(&p, "mode") {
                    "appearance" => b.appearance.clone(),
                    "both" => {
                        if b.appearance.is_empty() {
                            b.text.clone()
                        } else {
                            format!("{}, {}", b.text, b.appearance)
                        }
                    }
                    _ => b.text.clone(),
                };
                if text.trim().is_empty() {
                    return Err("此词条没有所选应用内容".into());
                }
                if let Some(n) = p["negative"].as_bool() {
                    self.editor.project.state.is_negative = n
                }
                if p["createGroup"].as_bool().unwrap_or(false) {
                    let category = match b.category.as_str() {
                        "角色" => "Character",
                        "画师" => "Artist",
                        "服装组合" | "单件服饰" => "Clothing",
                        "姿势" => "Pose",
                        "背景" => "Background",
                        "场景" => "Scene",
                        _ => "Extra",
                    };
                    self.editor.insert_favorite(
                        &Favorite {
                            id: String::new(),
                            name: b.name,
                            text,
                            category: category.into(),
                            images: vec![],
                        },
                        p["start"].as_u64().map(|v| v as usize).unwrap_or_else(|| self.editor.current().text.encode_utf16().count()),
                        0,
                    )?
                } else {
                    self.editor
                        .insert(&text, p["start"].as_u64().map(|v| v as usize).unwrap_or_else(|| self.editor.current().text.encode_utf16().count()), 0, false)?
                }
                self.builtin.action("used", &b.id)?;
                save_session = true
            }
            "builtin.backup" => storage::write(Path::new(get(&p, "path")), &self.builtin.overlay)?,
            "builtin.restore" => self.builtin.import(Path::new(get(&p, "path")))?,
            "builtin.exportSource" => BuiltinLibrary::export_source(Path::new(get(&p, "path")))?,
            "snapshots.create" => {
                let old = self.editor.clone();
                self.editor.snapshot_with_generation(get(&p, "name"), Some(self.generation.clone()))?;
                if let Err(error) = self.persist("session.json", &self.editor.project) {
                    self.editor = old;
                    return Err(error);
                }
            }
            "snapshots.rename" => {
                if get(&p, "name").trim().is_empty() {
                    return Err("快照名称不能为空".into());
                }
                self.editor.transact(|e| {
                    let s = e
                        .project
                        .snapshots
                        .iter_mut()
                        .find(|s| s.id == get(&p, "id"))
                        .ok_or("快照不存在")?;
                    s.name = get(&p, "name").trim().into();
                    Ok(())
                })?;
                save_session = true
            }
            "snapshots.delete" => {
                self.editor.transact(|e| {
                    e.project.snapshots.retain(|s| s.id != get(&p, "id"));
                    Ok(())
                })?;
                save_session = true
            }
            "snapshots.restore" => {
                let generation = self.editor.project.snapshots.iter().find(|s| s.id == get(&p,"id")).ok_or("快照不存在")?.generation.clone();
                if let Some(g) = &generation { g.validate()?; }
                let old = self.editor.clone();
                let old_generation = self.generation.clone();
                self.editor.restore_snapshot(get(&p, "id"))?;
                if let Some(g) = generation {
                    self.editor.attach_generation(old_generation.clone(),g.clone());
                    self.generation = g;
                }
                if let Err(error) = self.persist_adoption() {
                    self.editor = old;
                    self.generation = old_generation;
                    return Err(error);
                }
            }
            "snapshots.compare" => {
                let find = |id: &str| {
                    if id == "current" {
                        Ok(&self.editor.project.state)
                    } else {
                        self.editor
                            .project
                            .snapshots
                            .iter()
                            .find(|s| s.id == id)
                            .map(|s| &s.state)
                            .ok_or("快照不存在")
                    }
                };
                let mut differences = editor::compare(
                    find(get(&p, "before"))?,
                    find(get(&p, "after"))?
                );
                let generation = |id: &str| {
                    if id == "current" { Some(&self.generation) }
                    else { self.editor.project.snapshots.iter().find(|s| s.id == id).and_then(|s| s.generation.as_ref()) }
                };
                if let (Some(a),Some(b)) = (generation(get(&p,"before")),generation(get(&p,"after"))) {
                    differences.extend(crate::parameter_diff::rows(a,b).into_iter().map(|r| {
                        let path = r["id"].as_str().unwrap_or("");
                        let label = r["label"].as_str().unwrap_or("");
                        let workspace = if path.contains("/model_controls/") { "模型" } else if path.contains("/groups") { "工作流" } else { "生成参数" };
                        let kind = if workspace == "模型" && label.contains("权重") { "模型参数" } else if workspace == "模型" && label.contains("模型") { "模型" } else { "参数" };
                        json!({"Workspace":workspace,"Kind":kind,"Term":label,"Before":r["from"],"After":r["to"]})
                    }));
                }
                let targets = |id: &str| if id == "current" { Some(&self.editor.project.comfy_group_targets) } else { self.editor.project.snapshots.iter().find(|s| s.id == id).and_then(|s| s.comfy_group_targets.as_ref()) };
                let (a,b) = (targets(get(&p,"before")),targets(get(&p,"after")));
                if let (Some(a), Some(b)) = (a,b) {
                    if a != b { differences.push(json!({"Workspace":"工作流","Kind":"参数","Term":"分组映射","Before":json!(a).to_string(),"After":json!(b).to_string()})); }
                }
                return Ok(json!(differences));
            }
            "lora.get" => return Ok(json!(self.loras)),
            "lora.scan" => {
                let roots: Vec<String> = parse_value(p["roots"].clone())?;
                let (next, warnings) = library::scan_loras(&self.loras, &roots)?;
                self.persist("lora-library.json", &next)?;
                self.loras = next;
                return Ok(json!({"data":self.loras,"warnings":warnings}));
            }
            "lora.save" => {
                let mut item: LoraAsset = parse_value(p["value"].clone())?;
                item.edited = true;
                item.links = item
                    .links
                    .iter()
                    .map(|l| library::normalize_link(l))
                    .collect::<Result<_, _>>()?;
                let mut next = self.loras.clone();
                let at = next
                    .items
                    .iter()
                    .position(|x| x.id == item.id)
                    .ok_or("LoRA 不存在")?;
                next.items[at] = item;
                library::validate_loras(&next)?;
                self.persist("lora-library.json", &next)?;
                self.loras = next;
                self.clean_images()?
            }
            "lora.batch" => {
                let targets = ids(&p);
                let mut next = self.loras.clone();
                for item in &mut next.items {
                    if targets.contains(&item.id) {
                        match get(&p, "action") {
                            "tags" => {
                                for tag in library::split_tags(get(&p, "tags")) {
                                    if !item.tags.iter().any(|s| s.eq_ignore_ascii_case(&tag)) {
                                        item.tags.push(tag)
                                    }
                                }
                            }
                            "favorite" => {
                                item.favorite = p["favorite"].as_bool().unwrap_or(!item.favorite)
                            }
                            _ => return Err("未知批量操作".into()),
                        }
                    }
                }
                self.persist("lora-library.json", &next)?;
                self.loras = next
            }
            "lora.readComfy" | "lora.refresh" => {
                let source = self.http("/prompt-editor/lora-library")?;
                let registered: Vec<String> = parse_value(source["roots"].clone())?;
                let roots = library::comfy_scan_roots(&self.loras, &registered);
                let (mut next, warnings) = library::scan_loras(&self.loras, &roots)?;
                next.comfy_roots = registered;
                for file in source["files"].as_array().into_iter().flatten() {
                    let path = get(file, "path");
                    let index = next
                        .items
                        .iter()
                        .position(|x| library::path_key(&x.file_path) == library::path_key(path));
                    let idx = if let Some(i) = index {
                        i
                    } else {
                        next.items.push(LoraAsset {
                            file_path: path.into(),
                            root: roots
                                .iter()
                                .find(|r| library::path_key(path).starts_with(&(library::path_key(r) + "/")))
                                .cloned()
                                .unwrap_or_default(),
                            model_key: get(file, "key").into(),
                            name: Path::new(path)
                                .file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .into(),
                            missing: !Path::new(path).is_file(),
                            ..Default::default()
                        });
                        next.items.len() - 1
                    };
                    let x = &mut next.items[idx];
                    x.model_key = get(file, "key").into();
                    if !x.edited {
                        let m = &file["metadata"];
                        for (key, target) in [
                            ("name", &mut x.name),
                            ("base_model", &mut x.base_model),
                            ("notes", &mut x.notes),
                            ("triggers", &mut x.triggers),
                        ] {
                            if let Some(s) = m[key].as_str() {
                                *target = s.into()
                            }
                        }
                        if let Some(a) = m["tags"].as_array() {
                            x.tags = a
                                .iter()
                                .filter_map(|v| v.as_str().map(str::to_string))
                                .collect()
                        }
                        x.favorite = m["favorite"].as_bool().unwrap_or(x.favorite);
                        if let Some(v) = parser::number(&m["strength"].to_string()) {
                            x.strength = v
                        }
                        if let Some(v) = parser::number(&m["clip_strength"].to_string()) {
                            x.clip_strength = v
                        }
                        if let Some(preview) =
                            m["preview_path"].as_str().or_else(|| m["preview"].as_str())
                        {
                            if Path::new(preview).is_file() {
                                if let Ok(r) =
                                    library::import_reference(&self.directory, Path::new(preview))
                                {
                                    if !x.images.contains(&r) {
                                        x.images.push(r)
                                    }
                                }
                            }
                        }
                    }
                }
                library::validate_loras(&next)?;
                self.persist("lora-library.json", &next)?;
                self.loras = next;
                return Ok(json!({"data":self.loras,"warnings":warnings}));
            }
            "lora.triggers.insert" => {
                let text = get(&p, "text").trim();
                if text.is_empty() {
                    return Err("请输入 LoRA 触发词".into());
                }
                let start = p["start"].as_u64()
                    .map_or_else(|| self.editor.current().text.encode_utf16().count(), |n| n as usize);
                self.save_editor_edit(|editor| {
                    if p["createGroup"] == true {
                        editor.insert_favorite(&Favorite {
                            id: String::new(),
                            name: get(&p, "name").into(),
                            text: text.into(),
                            category: "Extra".into(),
                            images: vec![],
                        }, start, 0)
                    } else {
                        editor.insert(text, start, 0, false)
                    }
                }, |_| true)?;
            }
            "lora.controller" => {
                let targets = ids(&p);
                let catalog = self.http("/prompt-editor/lora-library")?;
                let identity: HashMap<_, _> = catalog["files"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|f| {
                        let (path, key) = (f["path"].as_str()?, f["key"].as_str()?);
                        (!path.is_empty() && !key.is_empty()).then(|| (library::path_key(path), key))
                    })
                    .collect();
                let mut entries = vec![];
                let mut issues = vec![];
                for id in &targets {
                    let item = self
                        .loras
                        .items
                        .iter()
                        .find(|x| &x.id == id)
                        .ok_or("LoRA 不存在")?;
                    let path = Path::new(&item.file_path);
                    let path = if path.is_relative() { Path::new(&item.root).join(path) } else { path.to_path_buf() };
                    if let Some(key) = identity.get(&library::path_key(&path.to_string_lossy())) {
                        entries.push(LoraControlEntry {
                            name: (*key).into(),
                            strength: item.strength,
                            clip_strength: item.clip_strength,
                            active: true,
                        })
                    } else {
                        issues.push(item.name.clone())
                    }
                }
                if !issues.is_empty() {
                    return Err(format!(
                        "无法核对模型标识：{}；整批未添加",
                        issues.join("、")
                    ));
                }
                if !p["confirm"].as_bool().unwrap_or(false) {
                    return Ok(
                        json!({"entries":entries,"target":self.generation.models.lora.node_id}),
                    );
                }
                let mut next = self.generation.clone();
                next.models.lora.loras.extend(entries);
                next.validate()?;
                self.persist("generation.json", &next)?;
                self.generation = next
            }
            "reference.import" => {
                let path = if let Some(s) = p["path"].as_str() {
                    PathBuf::from(s)
                } else {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(get(&p, "base64"))
                        .map_err(|e| e.to_string())?;
                    if bytes.len() > 256 * 1024 * 1024 {
                        return Err("图片过大".into());
                    }
                    let temp = self.directory.join(format!("clipboard-{}.png", id()));
                    storage::atomic_bytes(&temp, &bytes)?;
                    let result = library::import_reference(&self.directory, &temp);
                    let _ = std::fs::remove_file(temp);
                    let relative = result?;
                    self.pending_images.insert(relative.clone());
                    return Ok(json!(relative));
                };
                let relative = library::import_reference(&self.directory, &path)?;
                self.pending_images.insert(relative.clone());
                return Ok(json!(relative));
            }
            "image.url" => {
                let requested = get(&p, "path");
                let path = library::resolve_reference(&self.directory, requested)
                    .unwrap_or_else(|| PathBuf::from(requested));
                let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
                if meta.len() > 32 * 1024 * 1024 {
                    return Err("预览图超过 32 MiB".into());
                }
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                let ext = path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                let mime = match ext.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "webp" => "image/webp",
                    "bmp" => "image/bmp",
                    "png" => "image/png",
                    _ => return Err("不支持此图片格式".into()),
                };
                return Ok(json!(format!(
                    "data:{};base64,{}",
                    mime,
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )));
            }
            "data.migrate" => {
                let dest = PathBuf::from(get(&p, "path"));
                self.session()?;
                storage::migrate_directory(&self.directory, &dest)?;
                let pointer = self.initial_directory.join("active-data-directory.txt");
                storage::atomic_bytes(&pointer, dest.to_string_lossy().as_bytes())?;
                self.directory = dest.clone();
                self.builtin.path = dest.join("builtin-prompts.user.json")
            }
            "bridge.config" => {
                let url = Self::validate_comfy_url(p["url"].as_str().unwrap_or(&self.comfy_url))?;
                let catalog = match Self::http_at(&url, "/prompt-editor/catalog")
                    .and_then(Self::validate_catalog)
                {
                    Ok(catalog) => catalog,
                    Err(error) => {
                        if url == self.comfy_url {
                            self.comfy_connected = false;
                        }
                        self.comfy_error = Some(error.clone());
                        return Err(error);
                    }
                };
                // Commit only after the candidate responds and its settings are safely written.
                if self.blocked.contains("comfy-connection.json") {
                    storage::backup(&self.directory.join("comfy-connection.json"))?;
                }
                storage::write(
                    &self.directory.join("comfy-connection.json"),
                    &ComfyConnection { url: url.clone() },
                )?;
                self.blocked.remove("comfy-connection.json");
                // A server restarted on the same port may no longer have a published workflow.
                self.model_catalog = json!({});
                self.comfy_url = url;
                self.catalog = catalog;
                self.comfy_connected = true;
                self.comfy_error = None;
            }
            "bridge.catalog" => {
                let catalog = self.read_catalog("/prompt-editor/catalog")?;
                self.catalog = catalog.clone();
                return Ok(catalog);
            }
            "bridge.models" => {
                let catalog = self.read_catalog("/prompt-editor/model-catalog")?;
                self.model_catalog = catalog.clone();
                return Ok(catalog);
            }
            "session.flush" => self.session()?,
            _ => return Err(format!("未知命令：{}", method)),
        }
        if save_session {
            self.session()?
        }
        Ok(self.state())
    }
    fn clean_images(&self) -> Result<(), String> {
        let used: HashSet<_> = self
            .favorites
            .items
            .iter()
            .flat_map(|f| f.images.iter())
            .chain(self.loras.items.iter().flat_map(|x| x.images.iter()))
            .chain(self.pending_images.iter())
            .collect();
        let dir = self.directory.join("reference-images");
        if !dir.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let e = entry.map_err(|e| e.to_string())?;
            let relative = format!("reference-images/{}", e.file_name().to_string_lossy());
            if !used.contains(&relative)
                && library::resolve_reference(&self.directory, &relative).is_some()
                && e.file_type().map_err(|e| e.to_string())?.is_file()
            {
                std::fs::remove_file(e.path()).map_err(|e| e.to_string())?
            }
        }
        Ok(())
    }
    pub fn snapshot(&mut self, version: u32) -> Result<Value, String> {
        if self.composing {
            return Err("正在输入法组词，请完成输入后重新运行".into());
        }
        if let Some(error) = self.generation_problem() {
            return Err(error.into());
        }
        self.generation.validate()?;
        for (w, label) in [
            (&self.editor.project.state.positive, "积极"),
            (&self.editor.project.state.negative, "消极"),
        ] {
            if let Some(e) = editor::parse_workspace(w).error {
                return Err(format!("{}提示词语法未完成：{}", label, e));
            }
        }
        let snapshot_id = id();
        if self.snapshots.len() >= 512 {
            if let Some(key) = self.snapshots.keys().next().cloned() {
                self.snapshots.remove(&key);
            }
        }
        self.snapshots.insert(
            snapshot_id.clone(),
            serde_json::to_string(&self.generation).unwrap(),
        );
        self.last_read = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        Ok(
            json!({"protocol_version":version,"positive":editor::format_prompt(&self.editor.project.state.positive),"negative":editor::format_prompt(&self.editor.project.state.negative),"generation":self.generation,"snapshot_id":snapshot_id}),
        )
    }
    pub fn commit(&mut self, id: &str) -> Result<bool, String> {
        if let Some(changed) = self.link_commit(id)? {
            return Ok(changed);
        }
        let Some(captured) = self.snapshots.remove(id) else {
            return Ok(false);
        };
        if self.generation_problem().is_some()
            || !self.generation.enabled
            || captured != serde_json::to_string(&self.generation).unwrap()
        {
            return Ok(false);
        }
        let mut next = self.generation.clone();
        next.advance_seed();
        self.persist("generation.json", &next)?;
        let changed = self.generation.seed != next.seed;
        self.generation = next;
        if let Some(ui) = &self.ui {
            let _ = ui("bridge-state-changed", Value::Null);
        }
        Ok(changed)
    }
}
fn bridge(shared: Shared, port: u16) {
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            if let Ok(mut s) = shared.lock() {
                s.bridge_error = Some(e.to_string())
            }
            return;
        }
    };
    for mut request in server.incoming_requests() {
        let host = request
            .headers()
            .iter()
            .find(|h| h.field.equiv("Host"))
            .map(|h| h.value.as_str())
            .unwrap_or("");
        let origin = request.headers().iter().any(|h| h.field.equiv("Origin"));
        if origin
            || ![format!("127.0.0.1:{}", port), format!("localhost:{}", port)]
                .contains(&host.to_string())
        {
            respond(
                request,
                403,
                json!({"error":"A loopback Host header is required; browser origins are not allowed"}),
                None,
            );
            continue;
        }
        let result = (|| {
            if matches!(request.url(), "/v1/prompts" | "/v2/state" | "/v2/commit") {
                prepare_ui(&shared)?;
            }
            let mut s = shared.lock().map_err(|_| "编辑器状态不可用".to_string())?;
            match (request.method().as_str(), request.url()) {
                ("GET", "/health") => Ok(json!({"protocol_version":1,"positive":"","negative":""})),
                ("GET", "/v1/prompts") => s.snapshot(1),
                ("GET", "/v2/state") => s.snapshot(2),
                ("POST", "/v2/commit") => {
                    if request.body_length().unwrap_or(8193) > 8192 {
                        return Err("Invalid commit length".into());
                    }
                    let mut body = String::new();
                    request
                        .as_reader()
                        .take(8193)
                        .read_to_string(&mut body)
                        .map_err(|e| e.to_string())?;
                    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
                    Ok(json!({"advanced":s.commit(get(&v,"snapshot_id"))?}))
                }
                _ => Err("Use GET /v1/prompts or /v2/state".into()),
            }
        })();
        match result {
            Ok(v) => respond(request, 200, v, None),
            Err(e) => respond(request, 409, json!({"error":e}), None),
        }
    }
}
fn prepare_ui(shared: &Shared) -> Result<(), String> {
    let pending = {
        let mut s = shared.lock().map_err(|_| "编辑器状态不可用")?;
        if let Some(ui) = s.ui.clone() {
            if !s.ui_ready {
                return Err("编辑器界面尚未就绪".into());
            }
            let (tx, rx) = std::sync::mpsc::channel();
            let id = id();
            s.prepare_ack = Some((id.clone(), tx));
            Some((ui, id, rx))
        } else {
            None
        }
    };
    if let Some((ui, id, rx)) = pending {
        ui("bridge-prepare", json!({"id":id}))?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "编辑器正忙，请完成输入后重试")??;
    }
    Ok(())
}
fn respond(request: tiny_http::Request, status: u16, value: Value, origin: Option<&str>) {
    let mut response = tiny_http::Response::from_string(value.to_string())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8")
                .unwrap(),
        )
        .with_header(tiny_http::Header::from_bytes("Cache-Control", "no-store").unwrap());
    if let Some(o) = origin {
        response = response
            .with_header(tiny_http::Header::from_bytes("Access-Control-Allow-Origin", o).unwrap())
            .with_header(
                tiny_http::Header::from_bytes("Access-Control-Allow-Headers", "Content-Type")
                    .unwrap(),
            )
            .with_header(
                tiny_http::Header::from_bytes("Access-Control-Allow-Methods", "POST, OPTIONS")
                    .unwrap(),
            )
    }
    let _ = request.respond(response);
}
#[tauri::command]
async fn rpc(
    method: String,
    payload: Option<Value>,
    state: tauri::State<'_, Shared>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if method == "runs.feedback" {
            return comfy_link::feedback_shared(&shared, app);
        }
        dispatch_rpc(&shared, &method, payload.unwrap_or(json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn dispatch_rpc(shared: &Shared, method: &str, payload: Value) -> Result<Value, String> {
    if method == "data.migrate" {
        return crate::comfy_process::migrate(shared, payload);
    }
    if method.starts_with("process.") {
        return crate::comfy_process::dispatch(shared, method, payload);
    }
    match method {
        "runs.poll" => comfy_link::poll_delta_shared(shared, &payload),
        "runs.submit" | "runs.preflight" | "runs.probe.prepare" => {
            comfy_link::mutation_shared(shared, method, payload)
        }
        "runs.diagnostics" | "runs.free" | "runs.locate" | "runs.queue" | "runs.probe.cancel" => {
            comfy_link::control_shared(shared, method, &payload)
        }
        "runs.image" => comfy_link::image_shared(shared, &payload),
        "runs.file" => comfy_link::file_shared(shared, &payload),
        _ => shared
            .lock()
            .map_err(|_| "编辑器状态不可用".to_string())?
            .rpc(method, payload),
    }
}
fn get_installed_fonts() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use std::collections::BTreeSet;
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let mut fonts = BTreeSet::new();
        let hives = [
            r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
            r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        ];
        for hive in hives {
            let mut cmd = Command::new("reg");
            cmd.args(["query", hive]);
            cmd.creation_flags(0x0800_0000);

            if let Ok(output) = cmd.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("HKEY_") {
                        continue;
                    }
                    if let Some((name_part, _)) = trimmed.split_once("REG_SZ") {
                        let raw_name = name_part.trim();
                        for sub in raw_name.split('&') {
                            let mut name = sub.trim().to_string();
                            if let Some(pos) = name.rfind(" (") {
                                name.truncate(pos);
                            }
                            let cleaned = name.trim().to_string();
                            if !cleaned.is_empty() {
                                fonts.insert(cleaned);
                            }
                        }
                    }
                }
            }
        }
        if !fonts.is_empty() {
            return fonts.into_iter().collect();
        }
    }
    vec![
        "Microsoft YaHei UI".into(),
        "Segoe UI".into(),
        "SimSun".into(),
        "SimHei".into(),
        "KaiTi".into(),
        "FangSong".into(),
        "Consolas".into(),
        "Arial".into(),
    ]
}

#[cfg(target_os = "windows")]
fn show_error_dialog(title: &str, message: &str) {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: usize, text: *const u16, caption: *const u16, typ: u32) -> i32;
    }
    let text: Vec<u16> = std::ffi::OsStr::new(message)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let caption: Vec<u16> = std::ffi::OsStr::new(title)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        MessageBoxW(0, text.as_ptr(), caption.as_ptr(), 0x0000_0010);
    }
}
fn record_fatal_error(data_dir: &Path, context: &str, detail: &str, headless: bool) {
    let line = format!(
        "[{}] {}: {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        context,
        detail
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("startup-error.log"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(std::env::temp_dir().join("PromptEditor-startup-error.log"))
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
    #[cfg(target_os = "windows")]
    if !headless {
        show_error_dialog(
            "Prompt Editor 启动失败",
            &format!(
                "{}\n\n{}\n\n日志已写入：{}",
                context,
                detail,
                data_dir.join("startup-error.log").display()
            ),
        );
    }
}
pub fn run() {
    let args: Vec<_> = std::env::args().collect();
    let headless = args.contains(&"--headless".to_string());
    let arg = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    #[cfg(target_os = "windows")]
    {
        if let Some(sys_root) = std::env::var_os("SystemRoot") {
            let _ = std::env::set_current_dir(&sys_root);
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                let _ = storage::ensure_dir(exe_dir);
                let _ = std::env::set_current_dir(exe_dir);
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let _ =
                storage::ensure_dir(&PathBuf::from(local).join("local.memo.prompt-editor-tauri"));
        }
        if let Some(roaming) = std::env::var_os("APPDATA") {
            let _ =
                storage::ensure_dir(&PathBuf::from(roaming).join("local.memo.prompt-editor-tauri"));
        }
    }
    let dir = arg("--data-dir")
        .or_else(|| arg("--data"))
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap()
                    .join("data")
            } else {
                std::env::current_exe()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .join("data")
            }
        });
    if let Err(e) = storage::ensure_dir(&dir) {
        record_fatal_error(&dir, "无法初始化数据目录", &e, headless);
        return;
    }
    #[cfg(target_os = "windows")]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        let default_wv = std::env::var_os("LOCALAPPDATA")
            .map(|p| PathBuf::from(p).join("local.memo.prompt-editor-tauri"));
        let wv_ok = default_wv
            .as_ref()
            .is_some_and(|p| storage::ensure_dir(p).is_ok());
        if !wv_ok {
            let fallback_wv = std::env::temp_dir().join("PromptEditor-webview");
            if storage::ensure_dir(&fallback_wv).is_ok() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &fallback_wv);
            }
        }
    }
    let panic_dir = dir.clone();
    std::panic::set_hook(Box::new(move |info| {
        record_fatal_error(
            &panic_dir,
            "程序发生未捕获异常 (panic)",
            &info.to_string(),
            headless,
        );
    }));
    let port = arg("--bridge-port")
        .and_then(|s| s.parse().ok())
        .unwrap_or(8189);
    let state = match AppState::new(dir.clone(), port) {
        Ok(s) => s,
        Err(e) => {
            record_fatal_error(&dir, "无法加载数据目录", &e, headless);
            return;
        }
    };
    let shared = Arc::new(Mutex::new(state));
    let bridge_state = shared.clone();
    std::thread::spawn(move || bridge(bridge_state, port));
    if cfg!(debug_assertions) && headless {
        let api_port = arg("--api-port")
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(1421);
        let server = tiny_http::Server::http(("127.0.0.1", api_port)).expect("开发 API 端口占用");
        for mut req in server.incoming_requests() {
            let shared = shared.clone();
            std::thread::spawn(move || {
                let allowed = ["http://127.0.0.1:1420", "http://localhost:1420"];
                let origin = req
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Origin"))
                    .map(|h| h.value.as_str().to_string());
                if origin
                    .as_ref()
                    .is_some_and(|o| !allowed.contains(&o.as_str()))
                {
                    respond(req, 403, json!({"error":"origin refused"}), None);
                    return;
                }
                if req.method().as_str() == "OPTIONS" {
                    respond(req, 200, json!({}), origin.as_deref());
                    return;
                }
                let result = (|| {
                    if req.method().as_str() != "POST" || req.url() != "/rpc" {
                        return Err("开发端点仅支持 POST /rpc".into());
                    }
                    if req.body_length().unwrap_or(32 * 1024 * 1024 + 1) > 32 * 1024 * 1024 {
                        return Err("请求过大".into());
                    }
                    let mut body = String::new();
                    req.as_reader()
                        .take(32 * 1024 * 1024 + 1)
                        .read_to_string(&mut body)
                        .map_err(|e| e.to_string())?;
                    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
                    dispatch_rpc(&shared, get(&v, "method"), v["payload"].clone())
                })();
                match result {
                    Ok(v) => respond(req, 200, json!({"result":v}), origin.as_deref()),
                    Err(e) => respond(req, 409, json!({"error":e}), origin.as_deref()),
                }
            });
        }
        return;
    }
    if let Err(e) = tauri::Builder::default()
        .manage(shared.clone())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![rpc, crate::comfy_web::create_comfy_webview])
        .setup(move |app| {
            if let Some(w) = app.get_webview_window("main") {
                let mut s = shared.lock().unwrap();
                let handle = app.handle().clone();
                s.ui = Some(Arc::new(move |event, payload| {
                    handle.emit(event, payload).map_err(|e| e.to_string())
                }));
                w.set_always_on_top(s.settings.topmost)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
    {
        record_fatal_error(&dir, "Tauri 运行失败", &e.to_string(), headless);
    }
}
