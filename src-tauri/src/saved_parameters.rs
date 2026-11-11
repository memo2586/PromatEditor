use crate::{
    image_import::{put_parameter, Candidate},
    model::BasicParameters,
};
use serde_json::Value;
use std::collections::HashMap;
pub fn read(text: &str, has_graph: bool) -> Option<Candidate> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let re = regex::Regex::new(r"(?im)^Steps\s*:\s*\d").unwrap();
    let index = re.find_iter(&normalized).last()?.start();
    let fields = fields(&normalized[index..]);
    if !has_graph
        && !fields
            .get("version")
            .is_some_and(|s| s.eq_ignore_ascii_case("ComfyUI"))
    {
        return None;
    }
    let prompts = normalized[..index].trim_end_matches('\n');
    let neg = regex::Regex::new(r"(?im)(?:^|\n)Negative prompt:\s?").unwrap();
    let negative = neg.find(prompts);
    let positive = negative
        .map_or(prompts, |m| prompts[..m.start()].trim_end_matches('\n'))
        .to_string();
    let negative = negative.map(|m| prompts[m.end()..].to_string());
    let mut out = Candidate {
        id: "parameters".into(),
        title: "图片已保存的生成信息".into(),
        positive: Some(positive),
        negative,
        parameters: BasicParameters::default(),
        is_output: true,
    };
    for (label, key) in [
        ("steps", "steps"),
        ("cfg scale", "cfg"),
        ("seed", "seed"),
        ("batch size", "batch_size"),
    ] {
        if let Some(value) = fields.get(label) {
            put_parameter(&mut out.parameters, key, &Value::String(value.clone()))
        }
    }
    if let Some(name) = fields.get("sampler") {
        if let Some(s) = sampler(name) {
            put_parameter(&mut out.parameters, "sampler", &Value::String(s));
        }
    }
    if let Some(size) = fields.get("size") {
        let re = regex::Regex::new(r"^(\d+)\s*[x×]\s*(\d+)$").unwrap();
        if let Some(c) = re.captures(size) {
            put_parameter(&mut out.parameters, "width", &Value::String(c[1].into()));
            put_parameter(&mut out.parameters, "height", &Value::String(c[2].into()));
        }
    }
    (out.parameters.values.len() >= 2).then_some(out)
}
fn fields(text: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let (mut start, mut depth, mut quote, mut escaped) = (0, 0, false, false);
    let mut field = |end: usize, start: usize| {
        let f = text[start..end].trim();
        if let Some((key, value)) = f.split_once(':') {
            result
                .entry(key.trim().to_lowercase())
                .or_insert_with(|| value.trim().to_string());
        }
    };
    for (i, c) in text.char_indices() {
        if quote {
            if escaped {
                escaped = false
            } else if c == '\\' {
                escaped = true
            } else if c == '"' {
                quote = false
            }
            continue;
        }
        match c {
            '"' => quote = true,
            '{' | '[' | '(' => depth += 1,
            '}' | ']' | ')' => depth = (depth - 1).max(0),
            ',' if depth == 0 => {
                field(i, start);
                start = i + 1
            }
            _ => (),
        }
    }
    field(text.len(), start);
    result
}
fn sampler(name: &str) -> Option<String> {
    let re = regex::Regex::new(r"(?i)\s+(Karras|Exponential)$").unwrap();
    let name = re.replace(name, "");
    let lower = name.to_lowercase();
    let alias = match lower.as_str() {
        "euler a" => "euler_ancestral",
        "euler" => "euler",
        "lms" => "lms",
        "heun" => "heun",
        "dpm2" => "dpm_2",
        "dpm2 a" => "dpm_2_ancestral",
        "dpm++ 2s a" => "dpmpp_2s_ancestral",
        "dpm++ 2m" => "dpmpp_2m",
        "dpm++ sde" => "dpmpp_sde",
        "dpm++ 2m sde" => "dpmpp_2m_sde",
        "dpm++ 3m sde" => "dpmpp_3m_sde",
        "dpm fast" => "dpm_fast",
        "dpm adaptive" => "dpm_adaptive",
        "ddim" => "ddim",
        "plms" => "plms",
        "lcm" => "lcm",
        _ => {
            if regex::Regex::new(r"^[a-z][a-z0-9_]*$")
                .unwrap()
                .is_match(&name)
            {
                &name
            } else {
                return None;
            }
        }
    };
    Some(alias.into())
}
