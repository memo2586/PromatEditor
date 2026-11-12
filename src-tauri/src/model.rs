use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
pub fn id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
pub fn one() -> Decimal {
    Decimal::ONE
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Term {
    #[serde(default = "id")]
    pub id: String,
    #[serde(default)]
    pub raw: String,
    #[serde(default)]
    pub base: String,
    #[serde(default)]
    pub key: String,
    pub kind: String,
    #[serde(default = "one")]
    pub weight: Decimal,
    #[serde(default)]
    pub weighted: bool,
    pub editable: bool,
    pub start: usize,
    pub length: usize,
    pub base_start: usize,
    pub base_length: usize,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub previous: Option<String>,
    #[serde(default)]
    pub next: Option<String>,
}
impl Term {
    pub fn display(&self) -> String {
        if self.group.is_some() && self.kind == "normal" {
            format!("({}:{})", self.base, self.weight.normalize())
        } else {
            self.raw.clone()
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Workspace {
    pub text: String,
    pub active: Vec<Term>,
    pub hidden: Vec<Term>,
    pub groups: Vec<VisualGroup>,
    pub layout: Vec<String>,
    pub parsed_text: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub natural: Vec<SourceRange>,
    pub caret: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_end: Option<usize>,
    pub scroll: f64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct SourceRange {
    pub start: usize,
    pub length: usize,
}
impl SourceRange {
    pub fn end(self) -> usize {
        self.start.saturating_add(self.length)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct VisualGroup {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub description: Option<String>,
    pub members: Vec<String>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct EditingState {
    pub positive: Workspace,
    pub negative: Workspace,
    pub is_negative: bool,
}
impl EditingState {
    pub fn current(&self) -> &Workspace {
        if self.is_negative {
            &self.negative
        } else {
            &self.positive
        }
    }
    pub fn current_mut(&mut self) -> &mut Workspace {
        if self.is_negative {
            &mut self.negative
        } else {
            &mut self.positive
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Snapshot {
    pub id: String,
    pub name: String,
    pub created: String,
    pub state: EditingState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation: Option<Generation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comfy_group_targets: Option<HashMap<String, String>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Project {
    #[serde(default = "id")]
    pub id: String,
    pub version: u32,
    pub parser_version: u32,
    pub state: EditingState,
    #[serde(default)]
    pub snapshots: Vec<Snapshot>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub comfy_group_targets: HashMap<String, String>,
}
impl Default for Project {
    fn default() -> Self {
        Self {
            id: id(),
            version: 2,
            parser_version: 1,
            state: EditingState::default(),
            snapshots: vec![],
            comfy_group_targets: HashMap::new(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Settings {
    pub step: Decimal,
    pub auto_load: bool,
    pub topmost: bool,
    pub compact: bool,
    pub generation_notifications: bool,
    pub auto_collapse_new_groups: bool,
    pub lora_copy_include_directory: bool,
    pub lora_copy_include_extension: bool,
    pub theme_color: String,
    pub theme_mode: String,
    pub font_family: String,
    pub background_image: Option<String>,
    pub background_opacity: f64,
    pub background_blur: f64,
    pub collapsed_groups: Vec<String>,
    pub excel: Option<String>,
    pub recent_projects: Vec<String>,
    pub width: f64,
    pub height: f64,
    pub normal_width: f64,
    pub normal_height: f64,
    pub left: f64,
    pub top: f64,
    pub maximized: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            step: Decimal::new(1, 1),
            auto_load: true,
            topmost: false,
            compact: false,
            generation_notifications: false,
            auto_collapse_new_groups: false,
            lora_copy_include_directory: false,
            lora_copy_include_extension: false,
            theme_color: "#7163D5".into(),
            theme_mode: "dark".into(),
            font_family: "".into(),
            background_image: None,
            background_opacity: 0.4,
            background_blur: 8.,
            collapsed_groups: vec![],
            excel: None,
            recent_projects: vec![],
            width: 1600.,
            height: 1000.,
            normal_width: 1600.,
            normal_height: 1000.,
            left: 50.,
            top: 30.,
            maximized: false,
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Favorite {
    pub id: String,
    pub name: String,
    pub text: String,
    pub category: String,
    pub images: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct FavoriteLibrary {
    pub version: u32,
    pub items: Vec<Favorite>,
}
impl Default for FavoriteLibrary {
    fn default() -> Self {
        Self {
            version: 3,
            items: vec![],
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct GroupSwitch {
    pub name: String,
    pub enabled: bool,
    pub bypasser_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LoraControlEntry {
    pub name: String,
    pub strength: Decimal,
    #[serde(rename = "clipStrength")]
    pub clip_strength: Decimal,
    pub active: bool,
}
impl Default for LoraControlEntry {
    fn default() -> Self {
        Self {
            name: String::new(),
            strength: one(),
            clip_strength: one(),
            active: true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LoaderControl {
    pub enabled: bool,
    pub node_id: String,
    pub node_type: String,
    pub model: String,
    pub weight_dtype: String,
    pub loras: Vec<LoraControlEntry>,
}
impl Default for LoaderControl {
    fn default() -> Self {
        Self {
            enabled: false,
            node_id: String::new(),
            node_type: String::new(),
            model: String::new(),
            weight_dtype: "default".into(),
            loras: vec![],
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ModelControls {
    pub lora: LoaderControl,
    pub unet: LoaderControl,
    pub vae: LoaderControl,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Generation {
    pub enabled: bool,
    pub seed: u64,
    pub seed_control: String,
    pub steps: u32,
    pub cfg: Decimal,
    pub sampler: String,
    pub width: u32,
    pub height: u32,
    pub batch_size: u32,
    pub groups: Vec<GroupSwitch>,
    #[serde(rename = "model_controls")]
    pub models: ModelControls,
}
pub const MAX_SEED: u64 = 9007199254740991;
impl Default for Generation {
    fn default() -> Self {
        let names = [
            "Regional Prompting",
            "Load Image",
            "Use SAMLoader",
            "Any Detailer (SAM 3.1)",
            "Hand ADetailer",
            "NSFW ADetailer",
            "Face ADetailer",
            "Eyes ADetailer",
            "Save Image",
            "Mask Detailer",
            "Detailer",
            "2ndSampler",
            "CFGZeroStar",
            "CLIP NegPip",
            "Ultimate SD Upscaler",
            "Hires PreDetailer",
            "Hires PostDetailer",
            "Apply Signature",
            "RTX Upscale",
            "Color Match",
            "Remove Background",
            "ControlNet LLLite",
        ];
        Self {
            enabled: false,
            seed: 0,
            seed_control: "fixed".into(),
            steps: 20,
            cfg: Decimal::from(7),
            sampler: "euler".into(),
            width: 1024,
            height: 1024,
            batch_size: 1,
            groups: names
                .iter()
                .enumerate()
                .map(|(i, n)| GroupSwitch {
                    name: n.to_string(),
                    enabled: (3..=10).contains(&i) || i == 14 || i == 21,
                    bypasser_id: String::new(),
                })
                .collect(),
            models: ModelControls::default(),
        }
    }
}
impl Generation {
    pub fn validate(&self) -> Result<(), String> {
        if self.seed > MAX_SEED {
            return Err("Seed 须在 0 到 9007199254740991 之间".into());
        }
        if !["fixed", "increment", "decrement", "randomize"].contains(&self.seed_control.as_str()) {
            return Err("生成后控制方式无效".into());
        }
        if self.steps < 1
            || self.steps > 10000
            || self.cfg < Decimal::ZERO
            || self.cfg > Decimal::from(100)
        {
            return Err("Steps 须为 1–10000，CFG 须为 0–100".into());
        }
        if self.sampler.trim().is_empty() || self.sampler.len() > 100 {
            return Err("请选择采样器".into());
        }
        if [self.width, self.height]
            .iter()
            .any(|v| *v < 16 || *v > 16384 || v % 8 != 0)
        {
            return Err("宽高须为 16–16384 之间的 8 的倍数".into());
        }
        if self.batch_size < 1 || self.batch_size > 4096 {
            return Err("批次数须为 1–4096".into());
        }
        let mut keys = std::collections::HashSet::new();
        if self.groups.len() > 256
            || self.groups.iter().any(|g| {
                g.name.trim().is_empty()
                    || g.name.chars().count() > 200
                    || g.bypasser_id.len() > 100
                    || !keys.insert(format!("{}\n{}", g.bypasser_id, g.name))
            })
        {
            return Err("工作流分组无效或存在重名分组".into());
        }
        for (c, types, label) in [
            (&self.models.lora, vec!["Lora Loader (LoraManager)"], "LoRA"),
            (
                &self.models.unet,
                vec!["UNETLoader", "Unet Loader (LoraManager)"],
                "UNet",
            ),
            (&self.models.vae, vec!["VAELoader"], "VAE"),
        ] {
            if c.node_id.len() > 100
                || c.model.len() > 2048
                || c.enabled
                    && (c.node_id.is_empty()
                        || !types.contains(&c.node_type.as_str())
                        || label != "LoRA" && c.model.is_empty())
            {
                return Err(format!("请选择 {} 的有效目标节点及模型", label));
            }
        }
        if self.models.unet.enabled
            && !["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"]
                .contains(&self.models.unet.weight_dtype.as_str())
        {
            return Err("UNet 精度无效".into());
        }
        if self.models.lora.loras.len() > 256
            || self.models.lora.loras.iter().any(|x| {
                x.name.trim().is_empty()
                    || x.name.len() > 2048
                    || [x.strength, x.clip_strength]
                        .iter()
                        .any(|v| *v < Decimal::from(-20) || *v > Decimal::from(20))
            })
        {
            return Err("LoRA 最多 256 项，强度须为 −20 至 20".into());
        }
        Ok(())
    }
    pub fn advance_seed(&mut self) {
        self.seed = match self.seed_control.as_str() {
            "increment" => {
                if self.seed == MAX_SEED {
                    0
                } else {
                    self.seed + 1
                }
            }
            "decrement" => {
                if self.seed == 0 {
                    MAX_SEED
                } else {
                    self.seed - 1
                }
            }
            "randomize" => rand::random::<u64>() & MAX_SEED,
            _ => self.seed,
        }
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct BasicParameters {
    #[serde(
        deserialize_with = "read_string_map",
        serialize_with = "write_string_map"
    )]
    pub values: HashMap<String, String>,
}
fn read_string_map<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<HashMap<String, String>, D::Error> {
    let v = serde_json::Value::deserialize(d)?;
    if let Some(a) = v.as_array() {
        a.iter()
            .map(|x| {
                Ok((
                    x["Key"]
                        .as_str()
                        .ok_or_else(|| serde::de::Error::custom("参数键无效"))?
                        .to_string(),
                    x["Value"]
                        .as_str()
                        .ok_or_else(|| serde::de::Error::custom("参数值无效"))?
                        .to_string(),
                ))
            })
            .collect()
    } else {
        serde_json::from_value(v).map_err(serde::de::Error::custom)
    }
}
fn write_string_map<S: serde::Serializer>(
    v: &HashMap<String, String>,
    s: S,
) -> Result<S::Ok, S::Error> {
    let mut keys = v.keys().collect::<Vec<_>>();
    keys.sort();
    keys.into_iter()
        .map(|k| serde_json::json!({"Key":k,"Value":v[k]}))
        .collect::<Vec<_>>()
        .serialize(s)
}
pub const BASIC_KEYS: [&str; 7] = [
    "seed",
    "steps",
    "cfg",
    "sampler",
    "width",
    "height",
    "batch_size",
];
impl BasicParameters {
    pub fn from_generation(g: &Generation) -> Self {
        let v = serde_json::to_value(g).unwrap();
        let mut b = Self::default();
        for k in BASIC_KEYS {
            b.values.insert(
                k.into(),
                if let Some(s) = v[k].as_str() {
                    s.to_string()
                } else {
                    v[k].to_string()
                },
            );
        }
        b
    }
    pub fn apply(&self, g: &mut Generation, key: &str) -> Result<(), String> {
        let s = self.values.get(key).ok_or("参数来源不可用")?;
        let mut v = serde_json::to_value(&g).unwrap();
        v[key] = if key == "sampler" {
            serde_json::Value::String(s.clone())
        } else {
            serde_json::from_str(s).map_err(|_| "参数必须是有效数值")?
        };
        *g = serde_json::from_value(v).map_err(|e| e.to_string())?;
        Ok(())
    }
}
pub const CATEGORIES: [&str; 8] = [
    "Quality",
    "Artist",
    "Character",
    "Clothing",
    "Pose",
    "Background",
    "Scene",
    "Extra",
];
