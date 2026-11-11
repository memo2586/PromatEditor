"""Read-only model discovery and browser-published root-graph targets."""
import asyncio
import importlib
import time
import os
import json
from aiohttp import web
from server import PromptServer
from .model_controls import TYPES, validate_models

_catalog = {"nodes": [], "updated_at": None}


async def model_choices():
    import nodes
    import folder_paths

    def options(node_type, field):
        cls = nodes.NODE_CLASS_MAPPINGS.get(node_type)
        if cls is None:
            return []
        choices = cls.INPUT_TYPES().get("required", {}).get(field, [[]])[0]
        return list(choices) if isinstance(choices, (tuple, list)) else []

    unets, lm_unets, vaes = await asyncio.gather(
        asyncio.to_thread(options, "UNETLoader", "unet_name"),
        asyncio.to_thread(options, "Unet Loader (LoraManager)", "unet_name"),
        asyncio.to_thread(options, "VAELoader", "vae_name"))
    loras = list(folder_paths.get_filename_list("loras"))
    loader = nodes.NODE_CLASS_MAPPINGS.get("Lora Loader (LoraManager)")
    if loader:
        # Resolve the installed plugin's module prefix, including hyphenated names.
        prefix = loader.__module__.rsplit(".nodes.", 1)[0]
        registry = importlib.import_module(prefix + ".services.service_registry").ServiceRegistry
        utils = importlib.import_module(prefix + ".utils.utils")
        scanner = await registry.get_lora_scanner()
        cache = await scanner.get_cached_data()
        roots = scanner.get_model_roots()
        loras.extend(utils._format_model_name_for_comfyui(item.get("file_path", ""), roots)
                     for item in cache.raw_data if item.get("file_path"))
    return {"unets": unets, "lm_unets": lm_unets, "vaes": vaes,
            "loras": sorted(set(name for name in loras if name))}


def register_model_routes():
    routes = PromptServer.instance.routes

    @routes.get("/prompt-editor/lora-library")
    async def lora_library(request):
        """File identity map, independent of an open browser workflow. Read-only."""
        try:
            import nodes
            import folder_paths
            roots = list(folder_paths.get_folder_paths("loras"))
            def standard_files():
                found = {}
                for name in folder_paths.get_filename_list("loras"):
                    path = folder_paths.get_full_path("loras", name)
                    if path:
                        found[os.path.normcase(os.path.abspath(path))] = {"path": path, "key": name}
                return found
            files = await asyncio.to_thread(standard_files)
            loader = nodes.NODE_CLASS_MAPPINGS.get("Lora Loader (LoraManager)")
            if loader:
                prefix = loader.__module__.rsplit(".nodes.", 1)[0]
                registry = importlib.import_module(prefix + ".services.service_registry").ServiceRegistry
                utils = importlib.import_module(prefix + ".utils.utils")
                scanner = await registry.get_lora_scanner()
                cache = await scanner.get_cached_data()
                lm_roots = scanner.get_model_roots()
                roots.extend(lm_roots)
                for item in cache.raw_data:
                    path = item.get("file_path", "")
                    if path:
                        tips = item.get("usage_tips") or {}
                        if isinstance(tips, str):
                            try:
                                tips = json.loads(tips)
                            except (ValueError, TypeError):
                                tips = {}
                        tips = tips if isinstance(tips, dict) else {}
                        def weight(value):
                            try:
                                number = float(value)
                                return number if -20 <= number <= 20 else 1
                            except (ValueError, TypeError):
                                return 1
                        civitai = item.get("civitai") or {}
                        words = civitai.get("trainedWords", []) if isinstance(civitai, dict) else []
                        preview = item.get("preview_url") or ""
                        preview = preview if os.path.isabs(preview) and os.path.isfile(preview) else ""
                        files[os.path.normcase(os.path.abspath(path))] = {
                            "path": path, "key": utils._format_model_name_for_comfyui(path, lm_roots),
                            "metadata": {"name": item.get("model_name") or "", "base_model": item.get("base_model") or "",
                                         "tags": item.get("tags") or [], "notes": item.get("notes") or "",
                                         "triggers": ", ".join(w for w in words if isinstance(w, str)) if isinstance(words, list) else "",
                                         "favorite": bool(item.get("favorite")),
                                         "preview_path": preview,
                                         "strength": weight(tips.get("strength", tips.get("weight", 1))),
                                         "clip_strength": weight(tips.get("clip_strength", 1))}}
            return web.json_response({"roots": list(dict.fromkeys(roots)), "files": list(files.values())})
        except Exception as exc:
            return web.json_response({"error": "LoRA 目录读取失败：" + str(exc)}, status=409)

    @routes.get("/prompt-editor/model-catalog")
    async def catalog(request):
        try:
            return web.json_response({**_catalog, **await model_choices()})
        except Exception as exc:
            return web.json_response({"error": "模型列表读取失败：" + str(exc)}, status=409)

    @routes.post("/prompt-editor/model-catalog")
    async def publish(request):
        try:
            if request.content_length is None or request.content_length > 2097152:
                raise ValueError("节点目录过大或缺少长度。")
            data = await request.json()
            entries = data.get("nodes")
            if not isinstance(entries, list) or len(entries) > 512:
                raise ValueError("节点目录无效。")
            seen = set()
            for entry in entries:
                kind = next((k for k, types in TYPES.items() if entry.get("node_type") in types), None)
                if (kind is None or not isinstance(entry.get("node_id"), str)
                        or not entry["node_id"] or entry["node_id"] in seen
                        or not isinstance(entry.get("title", ""), str)):
                    raise ValueError("目标节点无效或重复。")
                seen.add(entry["node_id"])
                if kind == "lora":
                    blank = lambda: {"enabled": False, "node_id": ""}
                    controls = {"lora": {**blank(), "loras": entry.get("loras", [])}, "unet": blank(), "vae": blank()}
                    validate_models(controls)
            _catalog.update(nodes=entries, updated_at=time.time())
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)
