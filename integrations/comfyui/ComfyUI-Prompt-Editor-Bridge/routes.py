import asyncio
import time
from urllib.parse import urlsplit
from aiohttp import web
from server import PromptServer
from .nodes import fetch_snapshot, commit_snapshot, validate_generation, SAMPLER_TYPE

_catalog = {"groups": [], "updated_at": None}


def register_routes():
    routes = PromptServer.instance.routes

    async def body(request):
        if request.content_length is not None and request.content_length > 131072:
            raise web.HTTPRequestEntityTooLarge(max_size=131072, actual_size=request.content_length)
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object")
        return data

    @routes.post("/prompt-editor/snapshot")
    async def snapshot(request):
        try:
            data = await body(request)
            state = await asyncio.to_thread(fetch_snapshot, data.get("editor_url", "http://127.0.0.1:8189"),
                                            data.get("timeout_seconds", 10), 2)
            return web.json_response(state)
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=409)

    @routes.post("/prompt-editor/commit")
    async def commit(request):
        try:
            data = await body(request)
            url, timeout = data.get("editor_url", "http://127.0.0.1:8189"), data.get("timeout_seconds", 10)
            # Validate address/ranges without fetching another snapshot.
            parsed = urlsplit(url)
            if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost")
                    or parsed.port is None or not 1024 <= parsed.port <= 65535 or parsed.username
                    or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                    or type(timeout) not in (int, float) or not 1 <= timeout <= 60):
                raise ValueError("Invalid local editor address or timeout")
            result = await asyncio.to_thread(commit_snapshot, url, timeout, data.get("snapshot_id", ""))
            return web.json_response(result)
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=409)

    @routes.get("/prompt-editor/catalog")
    async def catalog(request):
        return web.json_response({**_catalog, "samplers": list(SAMPLER_TYPE) if isinstance(SAMPLER_TYPE, (tuple, list)) else []})

    @routes.post("/prompt-editor/catalog")
    async def publish_catalog(request):
        try:
            data = await body(request)
            groups = data.get("groups")
            probe = {"enabled": False, "seed": 0, "seed_control": "fixed", "steps": 20, "cfg": 7,
                     "sampler": "euler", "width": 1024, "height": 1024, "batch_size": 1, "groups": groups}
            validate_generation(probe)
            _catalog.update(groups=groups, updated_at=time.time())
            return web.json_response({"ok": True})
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)
