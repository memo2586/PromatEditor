use crate::model::Generation;
use serde_json::{json, Value};

fn display(value: &Value) -> String {
    match value {
        Value::Null => "无".into(),
        Value::Bool(v) => if *v { "开启" } else { "关闭" }.into(),
        Value::String(s) => if s.is_empty() { "无".into() } else { s.clone() },
        Value::Array(items) => items.iter().map(display).collect::<Vec<_>>().join("；"),
        Value::Object(o) => {
            if let Some(name) = o.get("name") {
                if o.contains_key("strength") {
                    return format!("{} · 模型权重 {} · CLIP 权重 {} · {}", display(name), display(&value["strength"]), display(&value["clipStrength"]), display(&value["active"]));
                }
                return format!("{} · {} · 目标 {}", display(name), display(&value["enabled"]), display(&value["bypasser_id"]));
            }
            value.to_string()
        }
        _ => value.to_string(),
    }
}

/// Stable selectable paths. Arrays with a different membership are adopted as a unit.
pub fn rows(current: &Generation, target: &Generation) -> Vec<Value> {
    let a = serde_json::to_value(current).unwrap();
    let b = serde_json::to_value(target).unwrap();
    let mut out = vec![];
    let mut add = |path: String, label: String, from: &Value, to: &Value| {
        if from != to {
            out.push(json!({"id":format!("generation{path}"),"side":"parameters","path":path,"label":label,"from":display(from),"to":display(to)}));
        }
    };
    for (key, label) in [("enabled","参数同步"),("seed","Seed"),("seed_control","Seed 控制"),("steps","Steps"),("cfg","CFG"),("sampler","采样器"),("width","宽度"),("height","高度"),("batch_size","批量")] {
        add(format!("/{key}"),label.into(),&a[key],&b[key]);
    }
    let mut array = |path: &str, label: &str| {
        let aa = a.pointer(path).unwrap();
        let bb = b.pointer(path).unwrap();
        let av = aa.as_array().unwrap();
        let bv = bb.as_array().unwrap();
        if av.len() == bv.len() && av.iter().zip(bv).all(|(x,y)| x["name"] == y["name"]) {
            for (i,(x,y)) in av.iter().zip(bv).enumerate() {
                add(format!("{path}/{i}"), format!("{label} · {}", display(&y["name"])), x, y);
            }
        } else { add(path.into(),label.into(),aa,bb); }
    };
    array("/groups","工作流分组");
    array("/model_controls/lora/loras","LoRA 模型与权重");
    for (loader, label) in [("lora","LoRA"),("unet","UNet"),("vae","VAE")] {
        for (key, field) in [("enabled","控制"),("node_id","节点"),("node_type","节点类型"),("model","模型"),("weight_dtype","权重类型")] {
            let path = format!("/model_controls/{loader}/{key}");
            add(path.clone(),format!("{label} · {field}"),a.pointer(&path).unwrap(),b.pointer(&path).unwrap());
        }
    }
    out
}

pub fn merge(current: &Generation, target: &Generation, selected: &[String]) -> Result<Generation,String> {
    let mut value = serde_json::to_value(current).unwrap();
    let source = serde_json::to_value(target).unwrap();
    for row in rows(current,target) {
        if selected.iter().any(|id| row["id"].as_str() == Some(id.as_str())) {
            let path = row["path"].as_str().unwrap();
            *value.pointer_mut(path).ok_or("参数路径已改变")? = source.pointer(path).ok_or("目标参数不存在")?.clone();
        }
    }
    let generation: Generation = serde_json::from_value(value).map_err(|e| e.to_string())?;
    generation.validate()?;
    Ok(generation)
}
