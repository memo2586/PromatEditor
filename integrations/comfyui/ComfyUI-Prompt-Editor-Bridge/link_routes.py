"""Browser-executed, at-most-once relay. Queue/history are authoritative."""
import time
import os
from aiohttp import web
from server import PromptServer

PRESENCE_TTL = 16
CLAIM_TTL = 20
pages = {}
runs = {}
locations = {}


def prune_pages():
    now = time.monotonic()
    for key in list(pages):
        if now - pages[key]["seen"] > PRESENCE_TTL:
            del pages[key]


def reconcile(run, queue, history):
    sid = run["snapshot"]["snapshot_id"]
    def matches(prompt):
        snapshots = (prompt[3].get("extra_pnginfo", {}).get("workflow", {})
                     .get("extra", {}).get("prompt_editor_snapshots", {}))
        return any(s.get("snapshot_id") == sid for s in snapshots.values())
    for prompt in queue[0] + queue[1]:
        if matches(prompt):
            run.update(status="running" if prompt in queue[0] else "queued", prompt_id=prompt[1], seed_used=snapshot_used(prompt, sid))
            return
    for pid, entry in history.items():
        if matches(entry["prompt"]):
            status = entry.get("status", {})
            messages = status.get("messages", [])
            failure = next((m[1] for m in messages if m[0] in ("execution_error", "execution_interrupted")), None)
            if failure:
                raw = dict(failure)
                node_id = str(raw.get("node_id", ""))
                workflow = entry["prompt"][3].get("extra_pnginfo", {}).get("workflow", {})
                node = next((n for n in workflow.get("nodes", []) if str(n.get("id")) == node_id), {})
                raw["node_title"] = node.get("title") or raw.get("node_type") or node.get("type") or node_id
                run["execution_error"] = raw
            run.update(prompt_id=pid, seed_used=snapshot_used(entry["prompt"], sid), status="cancelled" if any(m[0] == "execution_interrupted" for m in messages) else "failed" if failure or status.get("status_str") == "error" else "completed",
                       error=(failure or {}).get("exception_message", "任务已中断" if failure else None),
                       outputs=[dict(image, node_id=str(node)) for node, output in entry.get("outputs", {}).items()
                                if snapshot_used(entry["prompt"], sid, [node])
                                for image in output.get("images", []) if isinstance(image, dict) and image.get("filename")])
            return
    if run["status"] == "dispatching" and time.monotonic() - run["created"] > CLAIM_TTL:
        run.update(status="rejected", error="浏览器未领取请求；未提交任务")
    elif run["status"] == "claimed" and time.monotonic() - run["created"] > CLAIM_TTL:
        run.update(status="unknown", error="受理结果不明；正在核对队列与历史，请勿重复提交")


def snapshot_used(prompt, sid, targets=None):
    snapshots = prompt[3].get("extra_pnginfo", {}).get("workflow", {}).get("extra", {}).get("prompt_editor_snapshots", {})
    visited = set()
    def visit(node):
        node = str(node)
        if node in visited or node not in prompt[2]: return
        visited.add(node)
        for value in prompt[2][node].get("inputs", {}).values():
            if isinstance(value, list) and len(value) == 2 and type(value[1]) is int:
                visit(value[0])
    for node in (prompt[4] if targets is None else targets): visit(node)
    return any(str(node) in visited and state.get("snapshot_id") == sid for node, state in snapshots.items())


def register_link_routes():
    routes = PromptServer.instance.routes
    @routes.get("/prompt-editor/image-path")
    async def image_path(request):
        import folder_paths
        kind = request.query.get("type", "output")
        roots = {"output": folder_paths.get_output_directory,
                 "temp": folder_paths.get_temp_directory,
                 "input": folder_paths.get_input_directory}
        if kind not in roots:
            return web.json_response({"error": "不支持的图片目录类型"}, status=400)
        root = os.path.realpath(roots[kind]())
        filename = request.query.get("filename", "")
        subfolder = request.query.get("subfolder", "")
        try:
            path = os.path.realpath(os.path.join(root, subfolder, filename))
            if not filename or os.path.commonpath([root, path]) != root:
                raise ValueError("outside image directory")
        except (ValueError, OSError):
            return web.json_response({"error": "图片路径超出输出目录"}, status=400)
        if not os.path.isfile(path):
            return web.json_response({"error": "图片不存在，可能已删除或临时文件已清理"}, status=404)
        if os.path.splitext(path)[1].lower() not in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".avif", ".tif", ".tiff"):
            return web.json_response({"error": "不是支持的图片文件"}, status=400)
        return web.json_response({"path": path})

    async def body(request):
        if request.content_length is None or request.content_length > 2_000_000:
            raise web.HTTPRequestEntityTooLarge(max_size=2_000_000, actual_size=request.content_length or 0)
        data = await request.json()
        if not isinstance(data, dict):
            raise web.HTTPBadRequest(text="Expected object")
        return data

    @routes.post("/prompt-editor/free")
    async def free_idle(request):
        await body(request)
        queue = PromptServer.instance.prompt_queue
        running, pending = queue.get_current_queue()
        if running or pending or any(r["status"] in ("dispatching", "claimed", "unknown") for r in runs.values()):
            return web.json_response({"error": "队列或受理中任务存在，不能释放显存"}, status=409)
        # Same flags as ComfyUI POST /free. The worker applies these asynchronously.
        queue.set_flag("unload_models", True)
        queue.set_flag("free_memory", True)
        return web.json_response({"ok": True, "scheduled": True})

    @routes.post("/prompt-editor/locate")
    async def locate(request):
        data = await body(request)
        prune_pages()
        page = pages.get(data.get("client_id"))
        if (not page or page["fingerprint"] != data.get("fingerprint")
                or not any(b.get("editor_url") == data.get("editor_url") for b in page["bridges"])):
            return web.json_response({"error": "原工作流页面已关闭、切换或解除绑定，无法定位"}, status=409)
        if not page.get("capabilities", {}).get("locate"):
            return web.json_response({"error": "浏览器前端不支持节点定位，请更新扩展并刷新"}, status=409)
        token = str(data.get("token", ""))
        if not token or token in locations or len(token) > 100:
            return web.json_response({"error": "无效定位请求"}, status=409)
        for key in list(locations):
            if time.monotonic() - locations[key]["created"] > 60: del locations[key]
        locations[token] = {"created": time.monotonic(), "client_id": data["client_id"], "status": "pending"}
        PromptServer.instance.send_sync("prompt-editor.locate", data, data["client_id"])
        return web.json_response({"ok": True})

    @routes.post("/prompt-editor/locate-receipt")
    async def locate_receipt(request):
        data = await body(request)
        action = locations.get(data.get("token"))
        if not action or action["client_id"] != data.get("client_id"):
            return web.json_response({"error": "定位请求不存在"}, status=409)
        if action["status"] == "pending":
            action.update(status="located" if data.get("ok") is True else "failed", error=data.get("error"))
        return web.json_response({"ok": True})

    @routes.get("/prompt-editor/locate-result")
    async def locate_result(request):
        action = locations.get(request.query.get("token"))
        return web.json_response(action or {"status": "expired"})

    @routes.post("/prompt-editor/presence")
    async def presence(request):
        data = await body(request)
        prune_pages()
        client = data.get("client_id")
        if not isinstance(client, str) or not client or len(client) > 200:
            return web.json_response({"error": "Browser socket is not ready"}, status=409)
        pages[client] = {"client_id": client, "fingerprint": data.get("fingerprint"),
                         "workflow": str(data.get("workflow", "工作流"))[:200],
                         "bridges": data.get("bridges", []), "groups": data.get("groups", []), "capabilities": data.get("capabilities", {}),
                         "seen": time.monotonic()}
        return web.json_response({"ok": True, "pending": [key for key, run in runs.items()
            if run["client_id"] == client and run["status"] == "dispatching"
            and time.monotonic() - run["created"] <= CLAIM_TTL]})

    @routes.get("/prompt-editor/link")
    async def status(request):
        prune_pages()
        queue = PromptServer.instance.prompt_queue.get_current_queue()
        history = PromptServer.instance.prompt_queue.get_history()
        for run in runs.values():
            reconcile(run, queue, history)
        return web.json_response({"protocol": 1, "bridge_version": "1.4.0-dev",
            "pages": [{k: v for k, v in page.items() if k != "seen"} for page in pages.values()],
            "runs": [{k: v for k, v in run.items() if k not in ("snapshot", "created", "fingerprint")} for run in runs.values()],
            "queue": {"running": [p[1] for p in queue[0]], "pending": [p[1] for p in queue[1]]}})

    @routes.post("/prompt-editor/run")
    async def submit(request):
        data = await body(request)
        rid = data.get("request_id")
        if not isinstance(rid, str) or not rid or len(rid) > 100:
            return web.json_response({"error": "Invalid request ID"}, status=400)
        if rid in runs:
            return web.json_response({"request_id": rid, "status": runs[rid]["status"]})
        prune_pages()
        page = pages.get(data.get("client_id"))
        snapshot = data.get("snapshot", {})
        if not page or page["fingerprint"] != data.get("fingerprint"):
            return web.json_response({"error": "浏览器工作流已离线或发生变化，请重新体检"}, status=409)
        if not isinstance(snapshot, dict) or not snapshot.get("snapshot_id") or snapshot.get("protocol_version") != 2:
            return web.json_response({"error": "Invalid locked snapshot"}, status=400)
        if not any(b.get("editor_url") == data.get("editor_url") for b in page["bridges"]):
            return web.json_response({"error": "工作流未绑定此编辑器"}, status=409)
        if len(runs) >= 1024:
            # Never evict uncertain requests, which would permit a duplicate delivery.
            terminal = next((key for key, run in runs.items() if run["status"] in ("completed", "failed", "rejected", "cancelled")), None)
            if terminal is None:
                return web.json_response({"error": "中继记录已满，请先处理未确认任务"}, status=409)
            del runs[terminal]
        runs[rid] = {**data, "status": "dispatching", "created": time.monotonic(), "outputs": [], "error": None}
        PromptServer.instance.send_sync("prompt-editor.run", {"request_id": rid}, data["client_id"])
        return web.json_response({"request_id": rid, "status": "dispatching"})

    @routes.post("/prompt-editor/claim")
    async def claim(request):
        data = await body(request)
        run = runs.get(data.get("request_id"))
        if (not run or run["status"] != "dispatching" or run["client_id"] != data.get("client_id")
                or run["fingerprint"] != data.get("fingerprint") or time.monotonic() - run["created"] > CLAIM_TTL):
            return web.json_response({"error": "请求已领取、过期或工作流已改变"}, status=409)
        run["status"] = "claimed"
        return web.json_response({k: run[k] for k in ("snapshot", "editor_url", "request_id", "fingerprint")})

    @routes.post("/prompt-editor/receipt")
    async def receipt(request):
        data = await body(request)
        run = runs.get(data.get("request_id"))
        if not run or run["client_id"] != data.get("client_id"):
            return web.json_response({"error": "Unknown request"}, status=409)
        if run["status"] not in ("completed", "failed", "cancelled"):
            run.update(status="queued" if data.get("prompt_id") else "rejected" if data.get("not_submitted") else "unknown",
                       prompt_id=data.get("prompt_id"), error=data.get("error"))
        return web.json_response({"ok": True})

    @routes.post("/prompt-editor/progress")
    async def progress(request):
        data = await body(request)
        for run in runs.values():
            if run.get("prompt_id") == data.get("prompt_id") and run["client_id"] == data.get("client_id"):
                run["progress"] = {key: data.get(key) for key in ("node", "value", "max", "preview", "remaining_seconds", "elapsed_seconds")}
        return web.json_response({"ok": True})

    @routes.post("/prompt-editor/queue-action")
    async def queue_action(request):
        data = await body(request)
        queue = PromptServer.instance.prompt_queue
        running, pending = queue.get_current_queue()
        if data.get("action") == "cancel-probe":
            targets = set(data.get("ids", []))
            current = data.get("prompt_id")
            if not targets.issubset({p[1] for p in pending}) or (current and (not running or running[0][1] != current)):
                return web.json_response({"error": "探针队列已变化，请重新确认"}, status=409)
            for pid in targets:
                queue.delete_queue_item(lambda p, target=pid: p[1] == target)
            if current:
                import nodes
                nodes.interrupt_processing()
        elif data.get("action") == "interrupt":
            # Reject a stale confirmation rather than interrupting the next job.
            if not running or running[0][1] != data.get("prompt_id"):
                return web.json_response({"error": "当前任务已变化，请重新确认"}, status=409)
            import nodes
            nodes.interrupt_processing()
        elif data.get("action") == "cancel":
            pid = data.get("prompt_id")
            if not any(p[1] == pid for p in pending):
                return web.json_response({"error": "等待任务已变化"}, status=409)
            queue.delete_queue_item(lambda p: p[1] == pid)
        elif data.get("action") == "clear":
            if sorted(data.get("ids", [])) != sorted(p[1] for p in pending):
                return web.json_response({"error": "等待队列已变化，请重新确认数量"}, status=409)
            # Delete only confirmed IDs. A newly enqueued job must survive.
            confirmed = set(data["ids"])
            for pid in confirmed:
                queue.delete_queue_item(lambda p, target=pid: p[1] == target)
        else:
            return web.json_response({"error": "Unknown action"}, status=400)
        removed = {p[1] for p in pending} - {p[1] for p in queue.get_current_queue()[1]}
        for run in runs.values():
            if run.get("prompt_id") in removed:
                run["status"] = "cancelled"
        return web.json_response({"ok": True})
