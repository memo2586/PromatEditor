"""Optional model controls; old generation snapshots remain valid."""
import math

TYPES = {"lora": ("Lora Loader (LoraManager)",),
         "unet": ("UNETLoader", "Unet Loader (LoraManager)"), "vae": ("VAELoader",)}
DTYPES = ("default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2")


def validate_models(controls):
    if controls is None:
        return
    if not isinstance(controls, dict):
        raise RuntimeError("模型控制格式无效。")
    for kind, types in TYPES.items():
        row = controls.get(kind)
        if not isinstance(row, dict) or type(row.get("enabled")) is not bool:
            raise RuntimeError("模型控制项目无效。")
        if not isinstance(row.get("node_id"), str) or len(row["node_id"]) > 100:
            raise RuntimeError("模型控制节点 ID 无效。")
        if row["enabled"]:
            if not row["node_id"].strip() or row.get("node_type") not in types:
                raise RuntimeError("模型控制目标无效。")
            if kind != "lora" and (not isinstance(row.get("model"), str) or not row["model"].strip() or len(row["model"]) > 2048):
                raise RuntimeError("请选择模型。")
            if kind == "unet" and row.get("weight_dtype") not in DTYPES:
                raise RuntimeError("UNet 权重精度无效。")
    entries = controls["lora"].get("loras")
    if not isinstance(entries, list) or len(entries) > 256:
        raise RuntimeError("LoRA 列表无效。")
    for entry in entries:
        if (not isinstance(entry, dict) or not isinstance(entry.get("name"), str)
                or not entry["name"].strip() or len(entry["name"]) > 2048
                or type(entry.get("active")) is not bool):
            raise RuntimeError("LoRA 项目无效。")
        for key in ("strength", "clipStrength"):
            value = entry.get(key)
            if type(value) not in (int, float) or not math.isfinite(value) or not -20 <= value <= 20:
                raise RuntimeError("LoRA 强度须为 −20 至 20。")


def has_model_controls(generation):
    return any(row.get("enabled") for row in (generation.get("model_controls") or {}).values() if isinstance(row, dict))
