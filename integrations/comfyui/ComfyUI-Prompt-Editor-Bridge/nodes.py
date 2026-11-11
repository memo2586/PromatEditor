import json
import socket
import math
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_snapshot(editor_url, timeout_seconds, protocol=1):
    """Fetch both workspaces atomically, bypassing system proxies and HTTP caches."""
    try:
        address = urlsplit(editor_url.strip())
        port = address.port
    except (ValueError, AttributeError) as exc:
        raise RuntimeError("编辑器地址无效，请填写 http://127.0.0.1:8189") from exc
    if (address.scheme != "http" or address.hostname not in ("127.0.0.1", "localhost")
            or address.username is not None or address.password is not None
            or address.path not in ("", "/") or address.query or address.fragment
            or port is None or not 1024 <= port <= 65535):
        raise RuntimeError("请填写本机编辑器地址，例如 http://127.0.0.1:8189（不要添加路径）。")
    if not isinstance(timeout_seconds, (int, float)) or not 1 <= timeout_seconds <= 60:
        raise RuntimeError("连接超时须在 1 到 60 秒之间。")
    endpoint = "http://{}:{}/{}".format(address.hostname, port, "v2/state" if protocol == 2 else "v1/prompts")
    request = Request(endpoint, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(request, timeout=timeout_seconds) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        detail = ""
        try:
            error = json.loads(exc.read(8192).decode("utf-8"))
            if isinstance(error, dict) and isinstance(error.get("error"), str):
                detail = error["error"]
        except (ValueError, OSError):
            pass
        finally:
            exc.close()
        raise RuntimeError("提示词编辑器拒绝读取（HTTP {}）：{}".format(
            exc.code, detail or "请检查编辑器是否就绪、提示词语法是否完整。")) from exc
    except (URLError, OSError, socket.timeout) as exc:
        raise RuntimeError("无法连接提示词编辑器 {}。请启动附带的新版编辑器，通过“项目 → ComfyUI 连接”核对端口。原因：{}".format(
            editor_url, exc)) from exc
    if len(payload) > MAX_RESPONSE_BYTES:
        raise RuntimeError("提示词响应超过 4 MiB，请缩短正文后重试。")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("编辑器返回的不是有效 UTF-8 JSON，请检查地址和编辑器版本。") from exc
    if (not isinstance(data, dict) or type(data.get("protocol_version")) is not int
            or data["protocol_version"] != protocol
            or not isinstance(data.get("positive"), str)
            or not isinstance(data.get("negative"), str)):
        raise RuntimeError("编辑器响应格式或协议版本不兼容，请使用附带的编辑器。")
    if protocol == 2:
        validate_generation(data.get("generation"))
        if not isinstance(data.get("snapshot_id"), str) or not data["snapshot_id"]:
            raise RuntimeError("编辑器缺少快照标识，请升级编辑器。")
    return data


def fetch_prompts(editor_url, timeout_seconds):
    data = fetch_snapshot(editor_url, timeout_seconds)
    return data["positive"], data["negative"]


def _model_helpers():
    if __package__:
        from . import model_controls
        return model_controls
    # The portable connection checker loads this exact file without a package.
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location("prompt_editor_model_controls", Path(__file__).with_name("model_controls.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_generation(g):
    validate_models = _model_helpers().validate_models
    validate_models(g.get("model_controls") if isinstance(g, dict) else None)
    if not isinstance(g, dict) or type(g.get("enabled")) is not bool:
        raise RuntimeError("生成参数格式无效。")
    for key, low, high in (("seed", 0, 9007199254740991), ("steps", 1, 10000),
                           ("width", 16, 16384), ("height", 16, 16384), ("batch_size", 1, 4096)):
        if type(g.get(key)) is not int or not low <= g[key] <= high:
            raise RuntimeError("生成参数 {} 超出范围。".format(key))
    if g["width"] % 8 or g["height"] % 8:
        raise RuntimeError("宽高必须是 8 的倍数。")
    if (type(g.get("cfg")) not in (int, float) or not math.isfinite(g["cfg"]) or not 0 <= g["cfg"] <= 100
            or g.get("seed_control") not in ("fixed", "increment", "decrement", "randomize")
            or not isinstance(g.get("sampler"), str) or not g["sampler"]):
        raise RuntimeError("CFG、生成后控制或采样器无效。")
    groups = g.get("groups")
    if not isinstance(groups, list) or len(groups) > 256:
        raise RuntimeError("分组列表无效。")
    seen = set()
    for group in groups:
        if (not isinstance(group, dict) or not isinstance(group.get("name"), str) or not group["name"].strip()
                or type(group.get("enabled")) is not bool or not isinstance(group.get("bypasser_id", ""), str)):
            raise RuntimeError("分组项目格式无效。")
        key = (group.get("bypasser_id", ""), group["name"])
        if key in seen:
            raise RuntimeError("分组重复，请重新读取工作流分组。")
        seen.add(key)


def commit_snapshot(editor_url, timeout_seconds, snapshot_id):
    # Address is validated by fetch_snapshot before this helper is called.
    address = urlsplit(editor_url.strip())
    if address.scheme != "http" or address.hostname not in ("127.0.0.1", "localhost") or address.port is None:
        raise RuntimeError("编辑器地址无效。")
    payload = json.dumps({"snapshot_id": snapshot_id}).encode("utf-8")
    request = Request("http://{}:{}/v2/commit".format(address.hostname, address.port), data=payload,
                      headers={"Content-Type": "application/json"}, method="POST")
    with build_opener(ProxyHandler({}), _NoRedirect()).open(request, timeout=timeout_seconds) as response:
        return json.loads(response.read(8192).decode("utf-8"))


GROUP_OUTPUTS = (
    ("Regional Prompting", "enable_regional_prompting"), ("Load Image", "enable_load_image"),
    ("Use SAMLoader", "enable_sam_loader"), ("Any Detailer (SAM 3.1)", "enable_any_detailer"),
    ("Hand ADetailer", "enable_hand_adetailer"), ("NSFW ADetailer", "enable_nsfw_adetailer"),
    ("Face ADetailer", "enable_face_adetailer"), ("Eyes ADetailer", "enable_eyes_adetailer"),
    ("Save Image", "enable_save_image"), ("Mask Detailer", "enable_mask_detailer"),
    ("Detailer", "enable_detailer"), ("2ndSampler", "enable_second_sampler"),
    ("CFGZeroStar", "enable_cfg_zero_star"), ("CLIP NegPip", "enable_clip_negpip"),
    ("Ultimate SD Upscaler", "enable_ultimate_upscaler"), ("Hires PreDetailer", "enable_hires_pre_detailer"),
    ("Hires PostDetailer", "enable_hires_post_detailer"), ("Apply Signature", "enable_signature"),
    ("RTX Upscale", "enable_rtx_upscale"), ("Color Match", "enable_color_match"),
    ("Remove Background", "enable_remove_background"), ("ControlNet LLLite", "enable_controlnet_lllite"),
)
try:
    from comfy.samplers import KSampler
    SAMPLER_TYPE = KSampler.SAMPLERS
except ImportError:
    # Allows the portable connection checker and standalone tests without ComfyUI.
    SAMPLER_TYPE = "STRING"


class PromptEditorPrompts:
    CATEGORY = "Prompt Editor"
    RETURN_TYPES = ("STRING", "STRING", "INT", "INT", "FLOAT", SAMPLER_TYPE, "INT", "INT", "INT", "STRING", "STRING") + ("BOOLEAN",) * len(GROUP_OUTPUTS)
    RETURN_NAMES = ("positive", "negative", "seed", "steps", "cfg", "sampler", "width", "height", "batch_size", "seed_control", "groups_json") + tuple(label for _, label in GROUP_OUTPUTS)
    FUNCTION = "read_prompts"
    DESCRIPTION = "从桌面编辑器读取提示词、采样/尺寸参数与分组开关。浏览器提交前冻结同一快照并同步旁路，成功入队后更新下一次 Seed。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "editor_url": ("STRING", {"default": "http://127.0.0.1:8189"}),
            "timeout_seconds": ("INT", {"default": 10, "min": 1, "max": 60}),
        }, "hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO", "prompt": "PROMPT"}}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # External editor contents are independent of node widgets. Force each run
        # to execute this source before its downstream consumers, even unchanged UI.
        return float("nan")

    def read_prompts(self, editor_url="http://127.0.0.1:8189", timeout_seconds=10, unique_id=None, extra_pnginfo=None, prompt=None):
        snapshots = (extra_pnginfo or {}).get("workflow", {}).get("extra", {}).get("prompt_editor_snapshots", {})
        data = snapshots.get(str(unique_id))
        if data is None:
            data = fetch_snapshot(editor_url, timeout_seconds, protocol=2)
            if _model_helpers().has_model_controls(data["generation"]):
                raise RuntimeError("模型控制需要新版前端扩展，请刷新浏览器并从浏览器提交任务。")
            if data["generation"]["enabled"] and data["generation"]["groups"]:
                raise RuntimeError("分组控制需要新版前端扩展：请刷新 ComfyUI 浏览器并从浏览器提交任务。")
        if (not isinstance(data, dict) or data.get("protocol_version") != 2
                or not isinstance(data.get("positive"), str) or not isinstance(data.get("negative"), str)):
            raise RuntimeError("提交的编辑器快照无效。")
        g = data.get("generation")
        validate_generation(g)
        if SAMPLER_TYPE != "STRING" and g["sampler"] not in SAMPLER_TYPE:
            raise RuntimeError("当前 ComfyUI 不支持采样器 {}，请在编辑器刷新采样器列表。".format(g["sampler"]))
        named, ambiguous = {}, set()
        for row in g["groups"]:
            if row["name"] in named and named[row["name"]] != row["enabled"]:
                ambiguous.add(row["name"])
            named[row["name"]] = row["enabled"]
        for consumer in (prompt or {}).values():
            for value in consumer.get("inputs", {}).values():
                if isinstance(value, list) and len(value) == 2 and str(value[0]) == str(unique_id):
                    index = value[1]
                    if type(index) is int and 11 <= index < 11 + len(GROUP_OUTPUTS) and GROUP_OUTPUTS[index - 11][0] in ambiguous:
                        raise RuntimeError("连接的开关输出有同名分组冲突，请改用 groups_json 和分组开关辅助节点按控制器 ID 读取。")
        result = (data["positive"], data["negative"], g["seed"], g["steps"], float(g["cfg"]),
                  g["sampler"], g["width"], g["height"], g["batch_size"], g["seed_control"],
                  json.dumps(g["groups"], ensure_ascii=False))
        return result + tuple(False if name in ambiguous else named.get(name, False) for name, _ in GROUP_OUTPUTS)


class PromptEditorGroupSwitch:
    CATEGORY = "Prompt Editor"
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("enabled",)
    FUNCTION = "read_switch"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"groups_json": ("STRING", {"forceInput": True}),
                             "group_name": ("STRING", {"default": "Regional Prompting"}),
                             "bypasser_id": ("STRING", {"default": ""})}}

    def read_switch(self, groups_json, group_name, bypasser_id=""):
        rows = json.loads(groups_json)
        found = [r for r in rows if r["name"] == group_name and (not bypasser_id or r.get("bypasser_id") == bypasser_id)]
        if len(found) != 1 or type(found[0].get("enabled")) is not bool:
            raise RuntimeError("分组不存在或有重名，请核对名称及控制器 ID。")
        return (found[0]["enabled"],)
