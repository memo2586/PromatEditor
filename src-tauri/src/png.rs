use crate::{model::*, storage};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Read, path::Path};
const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const MARKER: &[u8] = b"PromptEditor.Card\0";
const MAX_IMAGE: usize = 256 * 1024 * 1024;
const MAX_PROJECT: usize = 64 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Envelope {
    pub format: String,
    pub version: u32,
    pub project: Project,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<BasicParameters>,
}
struct Chunk<'a> {
    kind: &'a [u8],
    data: &'a [u8],
    whole: &'a [u8],
}
fn chunks(png: &[u8]) -> Result<Vec<Chunk<'_>>, String> {
    if png.len() < 45 || png.len() > MAX_IMAGE || !png.starts_with(SIGNATURE) {
        return Err("请选择有效 PNG 图片（最大 256 MiB）".into());
    }
    let mut out = vec![];
    let (mut at, mut data, mut end, mut cards) = (8, false, false, 0);
    while at < png.len() {
        if png.len() - at < 12 {
            return Err("PNG 数据块不完整".into());
        }
        let len = u32::from_be_bytes(png[at..at + 4].try_into().unwrap()) as usize;
        if len > png.len() - at - 12 {
            return Err("PNG 数据块长度不正确".into());
        }
        let kind = &png[at + 4..at + 8];
        if !kind.iter().all(u8::is_ascii_alphabetic) {
            return Err("PNG 数据块类型不正确".into());
        }
        let payload = &png[at + 8..at + 8 + len];
        let crc = u32::from_be_bytes(png[at + 8 + len..at + 12 + len].try_into().unwrap());
        if crc32fast::hash(&png[at + 4..at + 8 + len]) != crc {
            return Err("PNG 数据块校验失败，图片可能已损坏".into());
        }
        if out.is_empty()
            && (kind != b"IHDR"
                || len != 13
                || payload[..4] == [0, 0, 0, 0]
                || payload[4..8] == [0, 0, 0, 0])
            || !out.is_empty() && kind == b"IHDR"
        {
            return Err("PNG 图片头不正确".into());
        }
        if kind == b"iTXt" && payload.starts_with(MARKER) {
            cards += 1;
            if cards > 1 {
                return Err("提示词卡包含重复项目数据".into());
            }
        }
        if kind == b"IDAT" {
            data = true
        }
        out.push(Chunk {
            kind,
            data: payload,
            whole: &png[at..at + 12 + len],
        });
        at += 12 + len;
        if kind == b"IEND" {
            if len != 0 || at != png.len() {
                return Err("PNG 结尾不正确".into());
            }
            end = true;
            break;
        }
    }
    if !data || !end {
        return Err("PNG 图片数据不完整".into());
    }
    Ok(out)
}
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_IMAGE as u64 {
        return Err("图片超过 256 MiB".into());
    }
    let b = std::fs::read(path).map_err(|e| e.to_string())?;
    chunks(&b)?;
    Ok(b)
}
pub fn decode(png: &[u8]) -> Result<Option<Envelope>, String> {
    for c in chunks(png)? {
        if c.kind == b"iTXt" && c.data.starts_with(MARKER) {
            let bytes = &c.data[MARKER.len()..];
            if bytes.len() < 4 || bytes[..4] != [0, 0, 0, 0] || bytes.len() - 4 > MAX_PROJECT {
                return Err("提示词卡编码或大小不支持".into());
            }
            let mut card: Envelope = serde_json::from_slice(&bytes[4..])
                .map_err(|e| format!("提示词卡数据损坏：{}", e))?;
            if card.format != "PromptEditor.PromptCard" || card.version != 1 {
                return Err("提示词卡版本不支持".into());
            }
            crate::editor::validate(&mut card.project)?;
            if let Some(p) = &card.parameters {
                let mut g = Generation::default();
                for key in p.values.keys() {
                    if !BASIC_KEYS.contains(&key.as_str()) {
                        return Err("提示词卡参数无效".into());
                    }
                    p.apply(&mut g, key)?
                }
                g.validate()?
            }
            return Ok(Some(card));
        }
    }
    Ok(None)
}
fn append(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut hash = crc32fast::Hasher::new();
    hash.update(kind);
    hash.update(data);
    out.extend_from_slice(&hash.finalize().to_be_bytes())
}
pub fn encode(png: &[u8], project: &Project, generation: &Generation) -> Result<Vec<u8>, String> {
    let mut p = project.clone();
    crate::editor::validate(&mut p)?;
    generation.validate()?;
    let card = Envelope {
        format: "PromptEditor.PromptCard".into(),
        version: 1,
        project: p,
        parameters: Some(BasicParameters::from_generation(generation)),
    };
    let json = serde_json::to_vec(&card).map_err(|e| e.to_string())?;
    if json.len() > MAX_PROJECT {
        return Err("项目超过 64 MiB".into());
    }
    let mut payload = MARKER.to_vec();
    payload.extend_from_slice(&[0, 0, 0, 0]);
    payload.extend(json);
    let mut out = SIGNATURE.to_vec();
    for c in chunks(png)? {
        if c.kind == b"iTXt" && c.data.starts_with(MARKER) {
            continue;
        }
        if c.kind == b"IEND" {
            append(&mut out, b"iTXt", &payload)
        }
        out.extend_from_slice(c.whole)
    }
    if out.len() > MAX_IMAGE {
        return Err("保存后的 PNG 超过 256 MiB".into());
    }
    Ok(out)
}
pub fn save(
    path: &Path,
    cover: &[u8],
    project: &Project,
    g: &Generation,
    source: Option<&Path>,
    current: Option<&Path>,
) -> Result<(), String> {
    if path
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("png"))
    {
        return Err("提示词卡请保存为 .png".into());
    }
    let same = |a: &Path, b: &Path| {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
            || std::fs::canonicalize(a)
                .ok()
                .zip(std::fs::canonicalize(b).ok())
                .is_some_and(|(a, b)| a == b)
    };
    if source.is_some_and(|p| same(path, p)) {
        return Err("保存位置与封面原图相同，请选择新文件名".into());
    }
    if path.exists() {
        if !current.is_some_and(|p| same(path, p)) {
            return Err("此位置已有文件，请选择新文件名保存副本".into());
        }
        if decode(&read_image(path)?)?.is_none() {
            return Err("不能覆盖非提示词卡图片".into());
        }
    }
    storage::atomic_bytes(path, &encode(cover, project, g)?)
}
pub fn text(png: &[u8]) -> Result<HashMap<String, String>, String> {
    let mut map = HashMap::new();
    let mut total = 0;
    for c in chunks(png)? {
        if ![b"tEXt" as &[u8], b"zTXt", b"iTXt"].contains(&c.kind) {
            continue;
        }
        let Some(zero) = c.data.iter().take(80).position(|b| *b == 0) else {
            continue;
        };
        let key = String::from_utf8_lossy(&c.data[..zero]).to_string();
        if !["prompt", "workflow", "parameters"].contains(&key.as_str()) {
            continue;
        }
        if map.contains_key(&key) {
            return Err(format!("PNG 包含重复 {} 元数据", key));
        }
        let mut at = zero + 1;
        let mut compressed = false;
        if c.kind == b"zTXt" {
            if c.data.get(at) != Some(&0) {
                return Err("PNG 压缩文本不支持".into());
            }
            compressed = true;
            at += 1
        } else if c.kind == b"iTXt" {
            if at + 2 > c.data.len() || c.data[at] > 1 || c.data[at + 1] != 0 {
                return Err("PNG 国际文本不支持".into());
            }
            compressed = c.data[at] == 1;
            at += 2;
            for _ in 0..2 {
                at += c.data[at..]
                    .iter()
                    .position(|b| *b == 0)
                    .ok_or("PNG 国际文本不完整")?
                    + 1;
            }
        }
        let mut bytes = vec![];
        if compressed {
            flate2::read::ZlibDecoder::new(&c.data[at..])
                .take(16 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
        } else {
            bytes.extend_from_slice(&c.data[at..])
        }
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("PNG 文本解压后过大".into());
        }
        total += bytes.len();
        if total > 32 * 1024 * 1024 {
            return Err("PNG 元数据过大".into());
        }
        let value = if c.kind == b"iTXt" {
            String::from_utf8(bytes).map_err(|e| e.to_string())?
        } else {
            bytes.into_iter().map(char::from).collect()
        };
        map.insert(key, value);
    }
    Ok(map)
}
