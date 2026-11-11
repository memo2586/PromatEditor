use crate::{model::*, parser, storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::{Path, PathBuf},
};
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct BuiltinPrompt {
    pub id: String,
    pub name: String,
    pub english: String,
    pub category: String,
    pub subcategory: String,
    pub text: String,
    pub appearance: String,
    pub notes: String,
    pub source: String,
    pub source_data: String,
    #[serde(skip_deserializing)]
    pub modified: bool,
    #[serde(skip_deserializing)]
    pub starred: bool,
    #[serde(skip_deserializing)]
    pub last_used: i64,
    #[serde(skip)]
    pub search: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Overlay {
    pub version: u32,
    pub entries: Vec<BuiltinPrompt>,
    pub deleted: Vec<String>,
    pub stars: Vec<String>,
    #[serde(deserialize_with = "read_recent", serialize_with = "write_recent")]
    pub recent: HashMap<String, i64>,
}
fn write_recent<S: serde::Serializer>(v: &HashMap<String, i64>, s: S) -> Result<S::Ok, S::Error> {
    v.iter()
        .map(|(k, v)| json!({"Key":k,"Value":v}))
        .collect::<Vec<_>>()
        .serialize(s)
}
fn read_recent<'de, D: serde::Deserializer<'de>>(d: D) -> Result<HashMap<String, i64>, D::Error> {
    let v = Value::deserialize(d)?;
    if let Some(a) = v.as_array() {
        Ok(a.iter()
            .filter_map(|x| Some((x["Key"].as_str()?.to_string(), x["Value"].as_i64()?)))
            .collect())
    } else {
        serde_json::from_value(v).map_err(serde::de::Error::custom)
    }
}
impl Default for Overlay {
    fn default() -> Self {
        Self {
            version: 1,
            entries: vec![],
            deleted: vec![],
            stars: vec![],
            recent: HashMap::new(),
        }
    }
}
pub const BUILTIN_CATEGORIES: [&str; 11] = [
    "角色",
    "画师",
    "服装组合",
    "单件服饰",
    "姿势",
    "背景",
    "场景",
    "基础词池",
    "典型组合",
    "颜色搭配",
    "其他",
];
pub struct BuiltinLibrary {
    pub originals: Vec<BuiltinPrompt>,
    pub entries: Vec<BuiltinPrompt>,
    pub overlay: Overlay,
    pub path: PathBuf,
    pub error: Option<String>,
}
impl BuiltinLibrary {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        let mut decoded = String::new();
        flate2::read::GzDecoder::new(&include_bytes!("../data/builtin-prompts.json.gz")[..])
            .read_to_string(&mut decoded)
            .map_err(|e| e.to_string())?;
        let originals = serde_json::from_str(&decoded).map_err(|e| e.to_string())?;
        let (overlay, error) = if path.exists() {
            match storage::read::<Overlay>(&path).and_then(|v| {
                validate_overlay(&v)?;
                Ok(v)
            }) {
                Ok(v) => (v, None),
                Err(e) => (Overlay::default(), Some(e)),
            }
        } else {
            (Overlay::default(), None)
        };
        let mut s = Self {
            originals,
            entries: vec![],
            overlay,
            path,
            error,
        };
        s.rebuild();
        Ok(s)
    }
    pub fn rebuild(&mut self) {
        let deleted: HashSet<_> = self.overlay.deleted.iter().collect();
        let changes: HashMap<_, _> = self.overlay.entries.iter().map(|e| (&e.id, e)).collect();
        let original: HashSet<_> = self.originals.iter().map(|e| &e.id).collect();
        let stars: HashSet<_> = self.overlay.stars.iter().collect();
        self.entries = self
            .originals
            .iter()
            .chain(
                self.overlay
                    .entries
                    .iter()
                    .filter(|e| !original.contains(&e.id)),
            )
            .filter(|e| !deleted.contains(&e.id))
            .map(|e| {
                let mut e = changes.get(&e.id).copied().unwrap_or(e).clone();
                e.modified = changes.contains_key(&e.id) && original.contains(&e.id);
                e.starred = stars.contains(&e.id);
                e.last_used = *self.overlay.recent.get(&e.id).unwrap_or(&0);
                e.search = format!(
                    "{}\n{}\n{}\n{}\n{}\n{}\n{}",
                    e.name, e.english, e.category, e.subcategory, e.text, e.appearance, e.notes
                )
                .to_lowercase();
                e
            })
            .collect();
        self.entries.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
    }
    pub fn commit(&mut self, next: Overlay) -> Result<(), String> {
        if self.error.is_some() {
            return Err("用户词库读取失败，原文件已保护，请恢复有效备份".into());
        }
        validate_overlay(&next)?;
        storage::write(&self.path, &next)?;
        self.overlay = next;
        self.rebuild();
        Ok(())
    }
    pub fn query(&self, p: &Value) -> Value {
        let text = p["text"].as_str().unwrap_or("").to_lowercase();
        let words: Vec<_> = text.split_whitespace().collect();
        let category = p["category"].as_str().unwrap_or("全部词条");
        let main = p["mainCategory"].as_str().unwrap_or("全部主分类");
        let sub = p["subcategory"].as_str().unwrap_or("全部子分类");
        let sort = p["sort"].as_str().unwrap_or("名称排序");
        let mut records: Vec<_> = self
            .entries
            .iter()
            .filter(|e| {
                (category == "全部词条"
                    || category == "已星标" && e.starred
                    || category == "最近应用" && e.last_used > 0
                    || e.category == category)
                    && (main == "全部主分类" || e.category == main)
                    && (sub == "全部子分类" || e.subcategory == sub)
                    && words.iter().all(|w| e.search.contains(w))
            })
            .collect();
        if sort == "最近应用" || category == "最近应用" {
            records.sort_by_key(|e| std::cmp::Reverse(e.last_used))
        } else if sort == "分类排序" {
            records.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)))
        }
        let subcategories: Vec<_> = self
            .entries
            .iter()
            .filter(|e| {
                (category == "全部词条"
                    || category == "已星标" && e.starred
                    || category == "最近应用" && e.last_used > 0
                    || e.category == category)
                    && (main == "全部主分类" || e.category == main)
            })
            .map(|e| e.subcategory.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        let counts: HashMap<_, _> = BUILTIN_CATEGORIES
            .iter()
            .map(|c| (*c, self.entries.iter().filter(|e| &e.category == c).count()))
            .collect();
        let offset = p["offset"].as_u64().unwrap_or(0) as usize;
        let limit = p["limit"].as_u64().unwrap_or(100).min(500) as usize;
        // Resolve selection against every filtered record, not just the virtual page.
        let selected = p["selectedId"]
            .as_str()
            .and_then(|id| records.iter().find(|entry| entry.id == id));
        json!({"items":records.iter().skip(offset).take(limit).collect::<Vec<_>>(),"selected":selected,"total":records.len(),"seedCount":self.originals.len(),"counts":counts,"subcategories":subcategories,"error":self.error})
    }
    pub fn save(&mut self, mut e: BuiltinPrompt) -> Result<(), String> {
        if e.id.is_empty() {
            e.id = format!("user:{}", id())
        }
        validate_entry(&e, true)?;
        let mut next = self.overlay.clone();
        next.entries.retain(|x| x.id != e.id);
        next.deleted.retain(|x| x != &e.id);
        next.entries.push(e);
        self.commit(next)
    }
    pub fn action(&mut self, action: &str, id: &str) -> Result<(), String> {
        let mut next = self.overlay.clone();
        match action {
            "delete" => {
                if !next.deleted.contains(&id.into()) {
                    next.deleted.push(id.into())
                }
            }
            "restore" => {
                next.deleted.retain(|x| x != id);
                if self.originals.iter().any(|e| e.id == id) {
                    next.entries.retain(|e| e.id != id)
                }
            }
            "undelete" => next.deleted.retain(|x| x != id),
            "star" => {
                if next.stars.contains(&id.into()) {
                    next.stars.retain(|x| x != id)
                } else {
                    next.stars.push(id.into())
                }
            }
            "used" => {
                next.recent
                    .insert(id.into(), chrono::Utc::now().timestamp_millis());
            }
            _ => return Err("未知词库操作".into()),
        }
        self.commit(next)
    }
    pub fn import(&mut self, path: &Path) -> Result<(), String> {
        let next: Overlay = storage::read(path)?;
        validate_overlay(&next)?;
        storage::backup(&self.path)?;
        storage::write(&self.path, &next)?;
        self.error = None;
        self.overlay = next;
        self.rebuild();
        Ok(())
    }
    pub fn export_source(path: &Path) -> Result<(), String> {
        let mut bytes = vec![];
        flate2::read::GzDecoder::new(&include_bytes!("../data/source-presets.json.gz")[..])
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        storage::atomic_bytes(path, &bytes)
    }
}
fn validate_entry(e: &BuiltinPrompt, syntax: bool) -> Result<(), String> {
    if e.id.trim().is_empty()
        || e.name.trim().is_empty()
        || e.category.trim().is_empty()
        || e.text.trim().is_empty()
    {
        return Err("名称、分类与提示词不能为空".into());
    }
    if e.text.len() > 800000 || e.appearance.len() > 800000 {
        return Err("提示词过长".into());
    }
    if syntax {
        let s = format!("{}, {}", e.text, e.appearance);
        if let Some(err) = parser::parse(&s, None).error {
            return Err(err);
        }
    }
    Ok(())
}
fn validate_overlay(v: &Overlay) -> Result<(), String> {
    if v.version != 1 {
        return Err("内置词库备份版本不支持".into());
    }
    let mut ids = HashSet::new();
    for e in &v.entries {
        validate_entry(e, false)?;
        if !ids.insert(&e.id) {
            return Err("词条标识重复".into());
        }
    }
    if v.deleted
        .iter()
        .chain(&v.stars)
        .any(|id| id.trim().is_empty())
    {
        return Err("词条标识损坏".into());
    }
    Ok(())
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Lexeme {
    pub text: String,
    pub key: String,
    pub translation: String,
    pub count: u64,
    pub source: String,
}
#[derive(Default)]
pub struct Lexicon {
    pub positive: HashMap<String, Lexeme>,
    pub negative: HashMap<String, Lexeme>,
    pub path: Option<PathBuf>,
    pub modified: Option<std::time::SystemTime>,
    pub size: u64,
}
impl Lexicon {
    pub fn read(path: &Path) -> Result<Self, String> {
        use calamine::{open_workbook_auto, Reader};
        let mut wb = open_workbook_auto(path).map_err(|e| e.to_string())?;
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let mut s = Self {
            path: Some(path.into()),
            modified: meta.modified().ok(),
            size: meta.len(),
            ..Self::default()
        };
        if let Ok(range) = wb.worksheet_range("已分析作品") {
            let marker = range
                .get_value((1, 7))
                .map(ToString::to_string)
                .unwrap_or_default();
            if marker.starts_with("anima_prompt_analyzer/") && marker != "anima_prompt_analyzer/v1"
            {
                return Err("归并规则版本不兼容".into());
            }
        }
        for (name, map) in [
            ("积极提示词", &mut s.positive),
            ("消极提示词", &mut s.negative),
        ] {
            let range = wb
                .worksheet_range(name)
                .map_err(|_| format!("缺少工作表：{}", name))?;
            let mut header: Option<HashMap<String, usize>> = None;
            for (rowindex, row) in range.rows().enumerate() {
                let values: Vec<_> = row.iter().map(ToString::to_string).collect();
                if header.is_none() {
                    if ["提示词", "中文翻译", "使用次数"]
                        .iter()
                        .all(|n| values.iter().any(|v| v == n))
                    {
                        header = Some(
                            values
                                .iter()
                                .enumerate()
                                .map(|(i, s)| (s.clone(), i))
                                .collect(),
                        )
                    }
                    continue;
                }
                let h = header.as_ref().unwrap();
                let get = |n: &str| {
                    h.get(n)
                        .and_then(|i| values.get(*i))
                        .cloned()
                        .unwrap_or_default()
                };
                let text = get("提示词");
                if text.trim().is_empty() {
                    continue;
                }
                let count = get("使用次数").parse::<f64>().map_err(|_| {
                    format!("{} 第 {} 行：使用次数须为非负整数", name, rowindex + 1)
                })?;
                if !count.is_finite()
                    || count < 0.
                    || count.fract() != 0.
                    || count > i64::MAX as f64
                {
                    return Err("使用次数须为非负整数".into());
                }
                let mut key = get("归并键");
                let normalized = parser::normalize(&text);
                if key.is_empty() {
                    key = normalized
                } else if key != normalized {
                    return Err("归并键与规则 V1 不兼容".into());
                }
                let translation = get("中文翻译").trim().to_string();
                let translation = if translation == "待翻译" {
                    String::new()
                } else {
                    translation
                };
                let item = Lexeme {
                    text,
                    key: key.clone(),
                    translation,
                    count: count as u64,
                    source: "Excel".into(),
                };
                if let Some(prior) = map.get(&key) {
                    if prior.text != item.text
                        || prior.count != item.count
                        || prior.translation != item.translation
                    {
                        return Err("Excel 存在冲突归并键".into());
                    }
                } else {
                    map.insert(key, item);
                }
            }
            if header.is_none() {
                return Err(format!("{} 缺少必需列", name));
            }
        }
        Ok(s)
    }
    pub fn for_workspace(&self, negative: bool) -> &HashMap<String, Lexeme> {
        if negative {
            &self.negative
        } else {
            &self.positive
        }
    }
    pub fn search(&self, text: &str, negative: bool, limit: usize) -> Vec<Lexeme> {
        let key = parser::normalize(text);
        if key.is_empty() {
            return vec![];
        }
        let mut items: Vec<_> = self
            .for_workspace(negative)
            .values()
            .filter_map(|e| {
                let rank = if e.key == key || e.text.eq_ignore_ascii_case(text) {
                    0
                } else if e.key.starts_with(&key) {
                    1
                } else if e.key.contains(&key) {
                    2
                } else if e.translation.to_lowercase().contains(&text.to_lowercase()) {
                    3
                } else {
                    return None;
                };
                Some((rank, e))
            })
            .collect();
        items.sort_by(|(a, x), (b, y)| {
            a.cmp(b)
                .then(y.count.cmp(&x.count))
                .then(x.text.cmp(&y.text))
        });
        items
            .into_iter()
            .take(limit)
            .map(|(_, e)| e.clone())
            .collect()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct LoraAsset {
    pub id: String,
    pub file_path: String,
    pub root: String,
    pub model_key: String,
    pub name: String,
    pub aliases: String,
    pub series: String,
    pub base_model: String,
    pub tags: Vec<String>,
    pub triggers: String,
    pub notes: String,
    pub strength: rust_decimal::Decimal,
    pub clip_strength: rust_decimal::Decimal,
    pub favorite: bool,
    pub missing: bool,
    pub edited: bool,
    pub preview_checked: bool,
    pub size: u64,
    pub images: Vec<String>,
    pub source_images: Vec<String>,
    pub links: Vec<String>,
}
impl Default for LoraAsset {
    fn default() -> Self {
        Self {
            id: id(),
            file_path: String::new(),
            root: String::new(),
            model_key: String::new(),
            name: String::new(),
            aliases: String::new(),
            series: String::new(),
            base_model: String::new(),
            tags: vec![],
            triggers: String::new(),
            notes: String::new(),
            strength: one(),
            clip_strength: one(),
            favorite: false,
            missing: false,
            edited: false,
            preview_checked: false,
            size: 0,
            images: vec![],
            source_images: vec![],
            links: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct LoraData {
    pub version: u32,
    pub roots: Vec<String>,
    pub comfy_roots: Vec<String>,
    pub items: Vec<LoraAsset>,
}
impl Default for LoraData {
    fn default() -> Self {
        Self {
            version: 1,
            roots: vec![],
            comfy_roots: vec![],
            items: vec![],
        }
    }
}
pub fn split_tags(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.split([',', '，', ';', '；', '\r', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty() && seen.insert(s.to_lowercase()))
        .map(str::to_string)
        .collect()
}
pub fn normalize_link(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("请输入有效的网页链接".into());
    }
    let text = if text.contains("://") {
        text.to_string()
    } else {
        format!("https://{}", text)
    };
    let url = reqwest::Url::parse(&text).map_err(|_| "链接须为 http:// 或 https:// 网页地址")?;
    if !["https", "http"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("链接须为 http:// 或 https:// 网页地址".into());
    }
    Ok(url.into())
}
pub fn validate_loras(data: &LoraData) -> Result<(), String> {
    if data.version != 1 {
        return Err("LoRA 模型库版本不支持".into());
    }
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for x in &data.items {
        if x.id.is_empty()
            || x.file_path.is_empty()
            || !ids.insert(&x.id)
            || !paths.insert(x.file_path.to_lowercase())
            || [x.strength, x.clip_strength]
                .iter()
                .any(|v| *v < (-20).into() || *v > 20.into())
        {
            return Err("LoRA 模型库记录无效".into());
        }
        for l in &x.links {
            normalize_link(l)?;
        }
    }
    Ok(())
}
pub fn scan_loras(
    original: &LoraData,
    roots: &[String],
) -> Result<(LoraData, Vec<String>), String> {
    validate_loras(original)?;
    let mut data = original.clone();
    let mut unique = HashSet::new();
    data.roots = roots.iter().filter(|r| unique.insert(path_key(r))).cloned().collect();
    let mut warnings = vec![];
    for root in &data.roots.clone() {
        let mut seen = HashSet::new();
        let mut complete = true;
        if !Path::new(root).is_dir() {
            warnings.push(format!("目录不可用：{}", root));
            continue;
        }
        for entry in walkdir::WalkDir::new(root).follow_links(false) {
            let e = match entry {
                Ok(e) => e,
                Err(e) => {
                    warnings.push(e.to_string());
                    complete = false;
                    continue;
                }
            };
            if !e.file_type().is_file() {
                continue;
            }
            let p = e.path();
            if !p.extension().is_some_and(|s| {
                ["safetensors", "ckpt", "pt", "bin"]
                    .contains(&s.to_string_lossy().to_lowercase().as_str())
            }) {
                continue;
            }
            let file = p.to_string_lossy().to_string();
            seen.insert(path_key(&file));
            let index = data
                .items
                .iter()
                .position(|i| path_key(&i.file_path) == path_key(&file));
            let idx = if let Some(i) = index {
                i
            } else {
                let mut item = LoraAsset {
                    file_path: file.clone(),
                    root: root.clone(),
                    model_key: p
                        .strip_prefix(root)
                        .unwrap_or(p)
                        .to_string_lossy()
                        .replace('\\', "/"),
                    name: p.file_stem().unwrap_or_default().to_string_lossy().into(),
                    ..Default::default()
                };
                read_sidecar(&mut item, &mut warnings);
                data.items.push(item);
                data.items.len() - 1
            };
            let item = &mut data.items[idx];
            item.root = root.clone();
            item.missing = false;
            item.size = e.metadata().map(|m| m.len()).unwrap_or(0);
            item.source_images = find_images(p);
        }
        if complete {
            for x in data
                .items
                .iter_mut()
                .filter(|x| path_key(&x.root) == path_key(root))
            {
                x.missing = !seen.contains(&path_key(&x.file_path));
            }
        }
    }
    Ok((data, warnings))
}
pub fn path_key(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Refresh ComfyUI-managed roots while retaining manually configured folders.
/// Older bridges also report an uncreated optional output/loras directory.
pub fn comfy_scan_roots(original: &LoraData, registered: &[String]) -> Vec<String> {
    let managed: HashSet<_> = original.comfy_roots.iter().chain(registered).map(|r| path_key(r)).collect();
    let mut seen = HashSet::new();
    original.roots.iter().filter(|r| !managed.contains(&path_key(r)))
        .chain(registered.iter().filter(|r| Path::new(r).is_dir() || !path_key(r).ends_with("/output/loras")))
        .filter(|r| seen.insert(path_key(r))).cloned().collect()
}
fn find_images(p: &Path) -> Vec<String> {
    let stem = p.with_extension("").to_string_lossy().to_string();
    let mut out = vec![];
    for suffix in [".preview", "", ".example"] {
        for ext in ["jpg", "png", "jpeg", "webp", "bmp"] {
            let file = format!("{}{}.{}", stem, suffix, ext);
            if Path::new(&file).is_file() {
                out.push(file)
            }
        }
    }
    out
}
fn read_sidecar(x: &mut LoraAsset, warnings: &mut Vec<String>) {
    let p = Path::new(&x.file_path);
    let stem = p.with_extension("").to_string_lossy().to_string();
    let paths = [
        format!("{}.metadata.json", stem),
        format!("{}.metadata.json", x.file_path),
        format!("{}.civitai.info", stem),
    ];
    let Some(path) = paths.iter().find(|p| Path::new(p).is_file()) else {
        return;
    };
    let result: Result<(), String> = (|| {
        if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("元数据超过 8 MiB".into());
        }
        let v: Value = storage::read(Path::new(path))?;
        let string = |key: &str| v[key].as_str().unwrap_or("").to_string();
        if !string("model_name").is_empty() {
            x.name = string("model_name")
        }
        x.base_model = if string("base_model").is_empty() {
            string("baseModel")
        } else {
            string("base_model")
        };
        x.notes = string("notes");
        x.favorite = v["favorite"].as_bool().unwrap_or(false);
        x.tags = v["tags"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        let triggers = v["trainedWords"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(
                v["civitai"]["trainedWords"]
                    .as_array()
                    .into_iter()
                    .flatten(),
            )
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        x.triggers = triggers.join(", ");
        if let Ok(tips) = serde_json::from_str::<Value>(&string("usage_tips")) {
            for key in ["strength", "weight"] {
                if let Some(d) = parser::number(&tips[key].to_string()) {
                    if d >= (-20).into() && d <= 20.into() {
                        x.strength = d;
                        break;
                    }
                }
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        warnings.push(format!("元数据未导入：{}：{}", path, e));
    }
}
pub fn import_reference(data: &Path, path: &Path) -> Result<String, String> {
    use image::GenericImageView;
    use sha2::{Digest, Sha256};
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > 256 * 1024 * 1024 {
        return Err("参考图超过 256 MiB".into());
    }
    let mut reader = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|e| e.to_string())?;
    let image = if image.width().max(image.height()) > 2048 {
        image.resize(2048, 2048, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut rgb = image::RgbImage::new(image.width(), image.height());
    for (x, y, p) in image.pixels() {
        let a = p[3] as u32;
        rgb.put_pixel(
            x,
            y,
            image::Rgb([
                ((p[0] as u32 * a + 255 * (255 - a)) / 255) as u8,
                ((p[1] as u32 * a + 255 * (255 - a)) / 255) as u8,
                ((p[2] as u32 * a + 255 * (255 - a)) / 255) as u8,
            ]),
        );
    }
    let mut bytes = vec![];
    for q in [80, 72, 64, 56, 48] {
        bytes.clear();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, q)
            .encode_image(&rgb)
            .map_err(|e| e.to_string())?;
        if bytes.len() <= 1024 * 1024 {
            break;
        }
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let relative = format!("reference-images/{}.jpg", hash);
    let path = data.join(&relative);
    if !path.exists() {
        storage::atomic_bytes(&path, &bytes)?
    }
    Ok(relative)
}
pub fn resolve_reference(data: &Path, relative: &str) -> Option<PathBuf> {
    let s = relative.replace('\\', "/");
    let name = s.strip_prefix("reference-images/")?;
    if name.contains(['/', '\\', ':']) || !name.to_lowercase().ends_with(".jpg") {
        return None;
    }
    Some(data.join("reference-images").join(name))
}
