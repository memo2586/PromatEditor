use crate::saved_parameters::read as saved_parameters;
use crate::{editor, model::*, parser, png};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::Path,
};
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase", default)]
pub struct Candidate {
    pub id: String,
    pub title: String,
    pub positive: Option<String>,
    pub negative: Option<String>,
    pub parameters: BasicParameters,
    pub is_output: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct ImportData {
    #[serde(skip)]
    pub image: Vec<u8>,
    pub card: Option<png::Envelope>,
    pub candidates: Vec<Candidate>,
    pub warnings: Vec<String>,
}
pub fn read(path: &Path) -> Result<ImportData, String> {
    let image = png::read_image(path)?;
    let card = png::decode(&image)?;
    let metadata = png::text(&image)?;
    let (mut candidates, warnings) = read_metadata(&metadata);
    candidates.sort_by(|a, b| {
        (b.id == "parameters")
            .cmp(&(a.id == "parameters"))
            .then(b.is_output.cmp(&a.is_output))
            .then(a.id.cmp(&b.id))
    });
    Ok(ImportData {
        image,
        card,
        candidates,
        warnings,
    })
}
fn parse_json(s: &str) -> Result<Value, String> {
    let re = regex::Regex::new(r#""(?:[^"\\]|\\.)*"|(?:NaN|-?Infinity)"#).unwrap();
    let s = re.replace_all(s, |m: &regex::Captures| {
        if m[0].starts_with('"') {
            m[0].to_string()
        } else {
            "null".into()
        }
    });
    serde_json::from_str(&s).map_err(|e| e.to_string())
}
pub(crate) fn put_parameter(p: &mut BasicParameters, key: &str, v: &Value) {
    let s = if let Some(s) = v.as_str() {
        s.to_string()
    } else if v.is_number() {
        v.to_string()
    } else {
        return;
    };
    let mut g = Generation::default();
    let mut b = BasicParameters::default();
    b.values.insert(key.into(), s.clone());
    if b.apply(&mut g, key).is_ok() && g.validate().is_ok() {
        p.values.insert(key.into(), s);
    }
}
fn sampler(t: &str) -> bool {
    [
        "KSampler",
        "KSamplerAdvanced",
        "SamplerCustom",
        "SamplerCustomAdvanced",
    ]
    .contains(&t)
}
struct Graph {
    nodes: HashMap<String, Value>,
    snapshots: Value,
}
impl Graph {
    fn linked(&self, v: &Value) -> Option<String> {
        let a = v.as_array()?;
        if a.len() != 2 {
            return None;
        }
        let id = if let Some(s) = a[0].as_str() {
            s.to_string()
        } else {
            a[0].to_string()
        };
        self.nodes.contains_key(&id).then_some(id)
    }
    fn scalar(&self, v: &Value, depth: usize) -> Value {
        if depth > 24 {
            return Value::Null;
        }
        let Some(id) = self.linked(v) else {
            return if v.is_array() || v.is_object() {
                Value::Null
            } else {
                v.clone()
            };
        };
        let n = &self.nodes[&id];
        let t = n["class_type"].as_str().unwrap_or("");
        let input = &n["inputs"];
        if t == "PromptEditorPrompts" {
            let slot = v[1].as_u64().unwrap_or(99) as usize;
            let keys = [
                "positive",
                "negative",
                "seed",
                "steps",
                "cfg",
                "sampler",
                "width",
                "height",
                "batch_size",
            ];
            if slot >= keys.len() || self.snapshots[&id]["protocol_version"] != 2 {
                return Value::Null;
            }
            return if slot < 2 {
                self.snapshots[&id][keys[slot]].clone()
            } else {
                self.snapshots[&id]["generation"][keys[slot]].clone()
            };
        }
        if t == "Input Parameters (Image Saver)" {
            let keys = ["seed", "steps", "cfg", "sampler", "scheduler", "denoise"];
            return v[1]
                .as_u64()
                .and_then(|i| keys.get(i as usize))
                .map_or(Value::Null, |k| self.scalar(&input[*k], depth + 1));
        }
        if t == "easy showAnything" {
            return self.scalar(&input["anything"], depth + 1);
        }
        if t == "ImpactWildcardProcessor" && input["mode"] == "reproduce" {
            return self.scalar(&input["populated_text"], depth + 1);
        }
        if ![
            "PrimitiveNode",
            "PrimitiveInt",
            "PrimitiveFloat",
            "PrimitiveString",
            "INTConstant",
            "FloatConstant",
            "StringConstant",
            "Reroute",
            "easy int",
            "easy float",
            "easy string",
        ]
        .contains(&t)
        {
            return Value::Null;
        }
        for k in ["value", "text", "number", ""] {
            if !input[k].is_null() {
                return self.scalar(&input[k], depth + 1);
            }
        }
        Value::Null
    }
    fn conditioning(&self, v: &Value, mut seen: HashSet<String>, depth: usize) -> Option<String> {
        let id = self.linked(v)?;
        if depth > 32 || !seen.insert(id.clone()) {
            return None;
        }
        let n = &self.nodes[&id];
        let t = n["class_type"].as_str().unwrap_or("");
        let input = &n["inputs"];
        let keys = if t.starts_with("CLIPTextEncode") {
            vec!["text", "text_g", "text_l"]
        } else if t.starts_with("Conditioning") || t == "Reroute" {
            vec![
                "conditioning",
                "conditioning_1",
                "conditioning_2",
                "conditioning_to",
                "conditioning_from",
                "",
            ]
        } else {
            return None;
        };
        let mut out = vec![];
        for k in keys {
            let text = if t.starts_with("CLIPTextEncode") {
                self.scalar(&input[k], 0).as_str().map(str::to_string)
            } else {
                self.conditioning(&input[k], seen.clone(), depth + 1)
            };
            if let Some(s) = text {
                if !out.contains(&s) {
                    out.push(s)
                }
            }
        }
        if out.is_empty() {
            None
        } else {
            Some(out.join("\n"))
        }
    }
    fn upstream(&self, v: &Value, types: &[&str]) -> Option<&Value> {
        let mut queue = VecDeque::new();
        if let Some(id) = self.linked(v) {
            queue.push_back(id)
        }
        let mut seen = HashSet::new();
        while let Some(id) = queue.pop_front() {
            if seen.len() > 1024 {
                break;
            }
            if !seen.insert(id.clone()) {
                continue;
            }
            let n = &self.nodes[&id];
            if types.contains(&n["class_type"].as_str().unwrap_or("")) {
                return Some(n);
            }
            for v in n["inputs"].as_object().into_iter().flat_map(|m| m.values()) {
                if let Some(id) = self.linked(v) {
                    queue.push_back(id)
                }
            }
        }
        None
    }
}
fn workflow_nodes(v: &Value) -> HashMap<String, Value> {
    let mut links = HashMap::new();
    for l in v["links"].as_array().into_iter().flatten() {
        if l.as_array().is_some_and(|a| a.len() >= 4) {
            links.insert(l[0].to_string(), json!([l[1], l[2]]));
        }
    }
    let mut out = HashMap::new();
    for n in v["nodes"].as_array().into_iter().flatten().take(10000) {
        let id = n["id"]
            .as_str()
            .map(str::to_string)
            .unwrap_or(n["id"].to_string());
        let t = n["type"].as_str().unwrap_or("");
        let mut inputs = serde_json::Map::new();
        for p in n["inputs"].as_array().into_iter().flatten() {
            if let Some(k) = p["name"].as_str() {
                if let Some(l) = links.get(&p["link"].to_string()) {
                    inputs.insert(k.into(), l.clone());
                }
            }
        }
        let widgets = n["widgets_values"].as_array().cloned().unwrap_or_default();
        let names = match t {
            "KSampler" => {
                if widgets.get(1).is_some_and(|v| v.is_string()) {
                    vec![
                        "seed",
                        "_mode",
                        "steps",
                        "cfg",
                        "sampler_name",
                        "_scheduler",
                        "_denoise",
                    ]
                } else {
                    vec![
                        "seed",
                        "steps",
                        "cfg",
                        "sampler_name",
                        "_scheduler",
                        "_denoise",
                    ]
                }
            }
            "KSamplerAdvanced" => {
                if widgets.get(2).is_some_and(|v| v.is_string()) {
                    vec![
                        "_add_noise",
                        "noise_seed",
                        "_mode",
                        "steps",
                        "cfg",
                        "sampler_name",
                    ]
                } else {
                    vec!["_add_noise", "noise_seed", "steps", "cfg", "sampler_name"]
                }
            }
            "CLIPTextEncode" => vec!["text"],
            "EmptyLatentImage" | "EmptySD3LatentImage" => vec!["width", "height", "batch_size"],
            "PrimitiveNode" => vec!["value"],
            "RandomNoise" => vec!["noise_seed"],
            "KSamplerSelect" => vec!["sampler_name"],
            "CFGGuider" => vec!["cfg"],
            "BasicScheduler" => vec!["_scheduler", "steps"],
            _ => vec![],
        };
        for (k, v) in names.into_iter().zip(widgets) {
            inputs.entry(k).or_insert(v);
        }
        out.insert(id, json!({"class_type":t,"inputs":inputs}));
    }
    out
}
fn read_metadata(m: &HashMap<String, String>) -> (Vec<Candidate>, Vec<String>) {
    let mut warnings = vec![];
    let workflow = m
        .get("workflow")
        .and_then(|s| parse_json(s).ok())
        .unwrap_or(Value::Null);
    let mut nodes = HashMap::new();
    if let Some(s) = m.get("prompt") {
        match parse_json(s) {
            Ok(mut v) => {
                if v["prompt"].is_object() {
                    v = v["prompt"].clone()
                }
                if let Some(map) = v.as_object() {
                    for (k, n) in map.iter().take(10000) {
                        if n["class_type"].is_string() {
                            nodes.insert(k.clone(), n.clone());
                        }
                    }
                }
            }
            Err(e) => warnings.push(format!("ComfyUI prompt 元数据无效：{}", e)),
        }
    }
    if !nodes
        .values()
        .any(|n| sampler(n["class_type"].as_str().unwrap_or("")))
    {
        nodes = workflow_nodes(&workflow)
    }
    let graph = Graph {
        nodes,
        snapshots: workflow["extra"]["prompt_editor_snapshots"].clone(),
    };
    let mut output_ids = HashSet::new();
    for n in graph
        .nodes
        .values()
        .filter(|n| ["SaveImage", "PreviewImage"].contains(&n["class_type"].as_str().unwrap_or("")))
    {
        if let Some(up) = graph.upstream(
            &n["inputs"]["images"],
            &[
                "KSampler",
                "KSamplerAdvanced",
                "SamplerCustom",
                "SamplerCustomAdvanced",
            ],
        ) {
            for (id, node) in &graph.nodes {
                if std::ptr::eq(node, up) {
                    output_ids.insert(id.clone());
                }
            }
        }
    }
    let mut candidates = vec![];
    for (id, n) in &graph.nodes {
        let t = n["class_type"].as_str().unwrap_or("");
        if !sampler(t) {
            continue;
        }
        let input = &n["inputs"];
        let guider = if t == "SamplerCustomAdvanced" {
            graph.upstream(&input["guider"], &["CFGGuider", "BasicGuider"])
        } else {
            None
        };
        let cond = guider.map(|n| &n["inputs"]).unwrap_or(input);
        let mut c = Candidate {
            id: id.clone(),
            title: format!("{} #{}", t, id),
            is_output: output_ids.contains(id),
            positive: graph.conditioning(
                if cond["positive"].is_null() {
                    &cond["conditioning"]
                } else {
                    &cond["positive"]
                },
                HashSet::new(),
                0,
            ),
            negative: graph.conditioning(&cond["negative"], HashSet::new(), 0),
            ..Default::default()
        };
        for (key, source) in [
            (
                "seed",
                if input["seed"].is_null() {
                    &input["noise_seed"]
                } else {
                    &input["seed"]
                },
            ),
            ("steps", &input["steps"]),
            ("cfg", &cond["cfg"]),
            ("sampler", &input["sampler_name"]),
        ] {
            put_parameter(&mut c.parameters, key, &graph.scalar(source, 0))
        }
        for (key, port, types, field) in [
            ("seed", "noise", vec!["RandomNoise"], "noise_seed"),
            (
                "steps",
                "sigmas",
                vec!["BasicScheduler", "KarrasScheduler", "ExponentialScheduler"],
                "steps",
            ),
            ("sampler", "sampler", vec!["KSamplerSelect"], "sampler_name"),
        ] {
            if !c.parameters.values.contains_key(key) {
                if let Some(up) = graph.upstream(&input[port], &types) {
                    put_parameter(
                        &mut c.parameters,
                        key,
                        &graph.scalar(&up["inputs"][field], 0),
                    )
                }
            }
        }
        if let Some(latent) = graph.upstream(
            &input["latent_image"],
            &["EmptyLatentImage", "EmptySD3LatentImage"],
        ) {
            for key in ["width", "height", "batch_size"] {
                put_parameter(
                    &mut c.parameters,
                    key,
                    &graph.scalar(&latent["inputs"][key], 0),
                )
            }
        }
        if c.positive.is_some() || c.negative.is_some() || !c.parameters.values.is_empty() {
            candidates.push(c)
        }
    }
    if let Some(s) = m.get("parameters") {
        if let Some(c) = saved_parameters(s, !graph.nodes.is_empty()) {
            candidates.push(c)
        }
    }
    (candidates, warnings)
}
pub fn plan(
    data: &ImportData,
    p: &Value,
    current: &Project,
    g: &Generation,
) -> Result<(Project, Generation, Vec<String>), String> {
    let full = p["fullCard"].as_bool().unwrap_or(false);
    let mut project = if full {
        data.card.as_ref().ok_or("提示词卡不可用")?.project.clone()
    } else {
        current.clone()
    };
    let mut generation = g.clone();
    let candidate = data
        .candidates
        .iter()
        .find(|c| c.id == p["candidate"].as_str().unwrap_or(""));
    let mut overwrites = vec![];
    let mut imported = false;
    for (negative, key) in [(false, "positiveSource"), (true, "negativeSource")] {
        let source = if full {
            "card"
        } else {
            p[key].as_str().unwrap_or("")
        };
        if source.is_empty() || source == "none" {
            continue;
        }
        let workspace = if source == "card" {
            let card = data.card.as_ref().ok_or("提示词卡来源不可用")?;
            if negative {
                card.project.state.negative.clone()
            } else {
                card.project.state.positive.clone()
            }
        } else if source == "comfy" {
            let c = candidate.ok_or("请选择有效生成节点")?;
            let text = if negative {
                c.negative.as_ref()
            } else {
                c.positive.as_ref()
            }
            .ok_or("选择的提示词来源不可用")?;
            let parsed = parser::parse(text, None);
            if !parsed.valid {
                return Err(parsed.error.unwrap());
            }
            let mut w = Workspace {
                text: text.clone(),
                parsed_text: Some(text.clone()),
                active: parsed.terms,
                ..Default::default()
            };
            editor::refresh(&mut w);
            w
        } else {
            return Err("提示词来源无效".into());
        };
        let previous = if negative {
            &current.state.negative
        } else {
            &current.state.positive
        };
        if !previous.text.is_empty() || !previous.hidden.is_empty() || !previous.groups.is_empty() {
            overwrites.push(
                if negative {
                    "消极提示词（含隐藏项与分组）"
                } else {
                    "积极提示词（含隐藏项与分组）"
                }
                .into(),
            )
        }
        if negative {
            project.state.negative = workspace
        } else {
            project.state.positive = workspace
        }
        imported = true
    }
    if full && !current.snapshots.is_empty() {
        overwrites.push("项目快照".into())
    }
    let enable = if full {
        data.card.as_ref().is_some_and(|c| c.parameters.is_some())
    } else {
        p["parametersEnabled"].as_bool().unwrap_or(true)
    };
    if enable {
        for key in BASIC_KEYS {
            let source = if full {
                "card"
            } else {
                p["parameterSources"][key].as_str().unwrap_or("")
            };
            if source.is_empty() || source == "none" {
                continue;
            }
            let basic = if source == "card" {
                data.card.as_ref().and_then(|c| c.parameters.as_ref())
            } else if source == "comfy" {
                candidate.map(|c| &c.parameters)
            } else {
                None
            }
            .ok_or("选择的参数来源不可用")?;
            basic.apply(&mut generation, key)?;
            overwrites.push(format!("生成参数 · {}", key));
            imported = true
        }
        generation.validate()?
    }
    if !imported {
        return Err("请至少选择一项可导入内容".into());
    }
    editor::validate(&mut project)?;
    Ok((project, generation, overwrites))
}
