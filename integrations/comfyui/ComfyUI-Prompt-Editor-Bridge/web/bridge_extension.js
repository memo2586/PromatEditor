import { graphNodes, collectGroups, planGroups, applyGroupPlan } from "./control_core.js";

export function installBridge(app, api, outputTypes = null) {
  if (app.__promptEditorBridgeInstalled) return;
  app.__promptEditorBridgeInstalled = true;
  let lastCatalog = "", publishing = false;
  let relay = null;
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = url => url.trim().replace("localhost", "127.0.0.1").replace(/\/$/, "");
  const documentId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  let workflowEpoch = 0;
  const loadGraph = app.loadGraphData;
  if (loadGraph) app.loadGraphData = function (...args) { workflowEpoch++; return loadGraph.apply(this,args); };
  async function request(path, data) {
    const response = await api.fetchApi(`/prompt-editor/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Prompt Editor HTTP ${response.status}`);
    return result;
  }
  const root = () => app.rootGraph || app.graph;
  const bridgeNodes = graph => graphNodes(graph).filter(n => n.type === "PromptEditorPrompts" && n.mode !== 2 && n.mode !== 4);
  const connection = node => ({
    editor_url: node.widgets?.find(w => w.name === "editor_url")?.value || "http://127.0.0.1:8189",
    timeout_seconds: node.widgets?.find(w => w.name === "timeout_seconds")?.value ?? 10,
  });
  const fingerprint = () => JSON.stringify({
    documentId, workflowEpoch,
    nodes: graphNodes(root()).map(n => [String(n.id), n.type, n.type === "PromptEditorPrompts" ? n.mode : null, (n.inputs || []).map(i => i.link)]),
    groups: collectGroups(root()).map(g => [g.id, g.name]),
  });
  async function publishPresence() {
    if (!api.clientId) return;
    const result = await request("presence", { client_id: api.clientId, fingerprint: fingerprint(),
      capabilities: { locate: typeof app.canvas?.centerOnNode === "function" && typeof app.canvas?.selectNode === "function" },
      workflow: app.graph?.extra?.workflowName || "浏览器工作流",
      bridges: bridgeNodes(root()).filter(n => !n.outputs || n.outputs.some(o => o.links?.length))
        .map(n => ({ node_id: String(n.id), editor_url: canonical(connection(n).editor_url) })),
      groups: collectGroups(root()).map(g => ({ name: g.name, enabled: !!g.widget.toggled, bypasser_id: g.id })),
    });
    for (const id of result.pending || []) enqueueRelay(id);
  }
  async function publishCatalog() {
    if (publishing || !bridgeNodes(root()).length) return;
    publishing = true;
    try {
      const groups = collectGroups(root()).map(e => ({ name: e.name, enabled: !!e.widget.toggled, bypasser_id: e.id }));
      const json = JSON.stringify(groups);
      if (json !== lastCatalog) { await request("catalog", { groups }); lastCatalog = json; }
    } catch (error) { console.warn("[Prompt Editor] 分组列表同步失败", error); }
    finally { publishing = false; }
  }
  const original = app.graphToPrompt;
  app.graphToPrompt = async function (graph = root(), ...args) {
    if (relay && (relay.serialized || fingerprint() !== relay.fingerprint)) throw new Error("中继请求的工作流发生变化，请重新体检");
    const bridges = bridgeNodes(graph).filter(node => !node.outputs || node.outputs.some(output => output.links?.length));
    if (!bridges.length) return original.call(this, graph, ...args);
    // Node ids inside subgraphs are expanded by ComfyUI; keep the external source
    // in the root graph so its metadata key remains stable.
    if (bridges.some(n => n.graph && n.graph !== graph)) throw new Error("请将提示词编辑器节点放在工作流主画布中。");
    const states = new Map(), snapshots = {}, connections = {};
    for (const node of bridges) {
      const config = connection(node), key = config.editor_url.trim();
      if (!states.has(key)) states.set(key, relay && canonical(key) === relay.editor_url
        ? clone(relay.snapshot) : await request("snapshot", config));
      snapshots[String(node.id)] = states.get(key);
      connections[String(node.id)] = config;
    }
    const entries = collectGroups(graph), plans = [];
    for (const state of states.values()) plans.push(...planGroups(state.generation, entries));
    const targets = new Map();
    for (const item of plans) {
      if (targets.has(item.widget.group) && targets.get(item.widget.group) !== item.enabled) throw new Error("多个编辑器对同一分组的设置冲突。");
      targets.set(item.widget.group, item.enabled);
    }
    applyGroupPlan(plans);
    const prompt = await original.call(this, graph, ...args);
    prompt.workflow.extra ||= {};
    prompt.workflow.extra.prompt_editor_snapshots = snapshots;
    if (relay) {
      if (!Object.values(snapshots).some(s => s.snapshot_id === relay.snapshot.snapshot_id)) throw new Error("工作流未包含锁定快照");
      relay.serialized = true;
    }
    // Transport-only connection data is retained on this object, not written to workflow metadata.
    Object.defineProperty(prompt, "__promptEditorConnections", { value: connections });
    return prompt;
  };
  const originalQueue = api.queuePrompt;
  api.queuePrompt = async function (number, data, ...args) {
    if (relay) relay.attempted = true;
    const result = await originalQueue.call(this, number, data, ...args);
    if (result.prompt_id) {
      const relaySnapshot = Object.values(data.workflow?.extra?.prompt_editor_snapshots || {})
        .find(s => relay && s.snapshot_id === relay.snapshot.snapshot_id);
      if (relaySnapshot) {
        relay.prompt_id = result.prompt_id;
        // Send before Seed acknowledgement: acceptance must survive a lost commit response.
        try { await request("receipt", { request_id: relay.request_id, client_id: api.clientId, prompt_id: result.prompt_id }); }
        catch (error) { console.warn("[Prompt Editor] 回执丢失，将通过队列/历史核对", error); }
      }
      const snapshots = data.workflow?.extra?.prompt_editor_snapshots || {}, done = new Set();
      const targets = args[0]?.partialExecutionTargets?.length ? args[0].partialExecutionTargets.map(String) : (outputTypes
        ? Object.entries(data.output || {}).filter(([, node]) => outputTypes.has(node.class_type)).map(([id]) => id)
        : Object.keys(data.output || {}));
      const used = new Set(), visit = id => {
        if (used.has(id) || !data.output?.[id]) return;
        used.add(id);
        for (const value of Object.values(data.output[id].inputs || {})) {
          if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[1])) visit(String(value[0]));
        }
      };
      targets.forEach(visit);
      for (const [id, state] of Object.entries(snapshots)) {
        if (!used.has(id) || !data.__promptEditorConnections?.[id] || done.has(state.snapshot_id)) continue;
        done.add(state.snapshot_id);
        try {
          await request("commit", { ...data.__promptEditorConnections[id], snapshot_id: state.snapshot_id });
        } catch (error) {
          // The job is already accepted. Do not throw and encourage duplicate submission.
          const message = `任务已加入队列，但下一次 Seed 更新失败：${error.message}`;
          console.error("[Prompt Editor]", message);
          app.ui?.dialog?.show?.(message);
        }
      }
    }
    return result;
  };
  const queue = app.queuePrompt;
  if (queue) app.queuePrompt = function (...args) {
    if (relay) { app.ui?.dialog?.show?.("Prompt Editor 正在提交锁定快照，请稍候"); return Promise.resolve(false); }
    return queue.apply(this, args);
  };
  async function runRelay(request_id) {
    if (app.processingQueue) return;
    try {
      const claimed = await request("claim", { request_id, client_id: api.clientId, fingerprint: fingerprint() });
      relay = claimed;
      // One queue operation per immutable snapshot. Never call /prompt directly.
      await queue.call(app, 0, 1);
      if (!relay.prompt_id) await request("receipt", { request_id, client_id: api.clientId, not_submitted: !relay.attempted, error: relay.attempted ? "浏览器未获得受理回执，请核对队列与历史" : "工作流验证未通过，任务未提交，请检查浏览器错误" });
    } catch (error) {
      if (relay) await request("receipt", { request_id, client_id: api.clientId, prompt_id: relay.prompt_id, not_submitted: !relay.attempted, error: error.message }).catch(() => {});
      console.warn("[Prompt Editor] 中继未完成", error);
    } finally { relay = null; }
  }
  let relayQueue = Promise.resolve();
  const scheduled = new Set();
  function enqueueRelay(id) {
    if (!id || scheduled.has(id)) return;
    scheduled.add(id);
    relayQueue = relayQueue.then(() => runRelay(id)).finally(() => scheduled.delete(id));
  }
  api.addEventListener?.("prompt-editor.run", event => enqueueRelay(event.detail?.request_id));
  api.addEventListener?.("prompt-editor.locate", async event => {
    const data = event.detail || {};
    let error = null;
    try {
      if (data.client_id !== api.clientId || data.fingerprint !== fingerprint()) throw new Error("工作流已切换，请重新定位");
      if (!bridgeNodes(root()).some(n => canonical(connection(n).editor_url) === data.editor_url)) throw new Error("工作流未绑定此编辑器");
      const node = graphNodes(root()).find(n => String(n.id) === String(data.node_id));
      if (!node) throw new Error("该工作流中找不到目标节点");
      if (node.graph && node.graph !== root()) throw new Error("目标在子图内，请在 ComfyUI 中打开对应子图");
      if (typeof app.canvas?.centerOnNode !== "function" || typeof app.canvas?.selectNode !== "function") throw new Error("此前端不支持节点定位");
      app.canvas.selectNode(node);
      app.canvas.centerOnNode(node);
      app.canvas.setDirty?.(true, true);
    } catch (e) { error = e.message; }
    await request("locate-receipt", { token: data.token, client_id: api.clientId, ok: !error, error }).catch(() => {});
  });
  let currentPrompt = null, node = null, lastProgress = 0, preview = null, step = {}, nodeStarted = 0, executionStarted = 0;
  const sendProgress = async (detail = {}) => {
    if (detail.value != null && detail.max != null) step = { value: detail.value, max: detail.max };
    const now = Date.now();
    if (!currentPrompt || now - lastProgress < 200) return;
    lastProgress = now;
    const title = graphNodes(root()).find(n => String(n.id) === String(node))?.title || node;
    const remaining_seconds = step.value > 0 ? Math.max(0, Math.round((now - nodeStarted) / 1000 / step.value * (step.max - step.value))) : null;
    await request("progress", { client_id: api.clientId, prompt_id: currentPrompt, node: title,
      ...step, remaining_seconds, elapsed_seconds: executionStarted ? Math.max(0, Math.floor((now - executionStarted) / 1000)) : null, preview }).catch(() => {});
  };
  api.addEventListener?.("executing", event => {
    // ComfyUI api.ts reduces this WebSocket message to a node ID in its DOM event.
    // execution_start retains prompt_id; also accept full messages from other versions.
    const detail = event.detail;
    if (detail && typeof detail === "object" && detail.prompt_id) currentPrompt = detail.prompt_id;
    const next = detail && typeof detail === "object" ? detail.node : detail;
    if(node !== next) { step={};nodeStarted=Date.now();lastProgress=0; }
    node = next;
    void sendProgress();
  });
  api.addEventListener?.("execution_start", event => { currentPrompt=event.detail?.prompt_id;node=null;step={};preview=null;executionStarted=Date.now();nodeStarted=executionStarted;lastProgress=0; });
  api.addEventListener?.("progress", event => {
    if(event.detail?.prompt_id) currentPrompt=event.detail.prompt_id;
    void sendProgress(event.detail);
  });
  const seenPreviews = new WeakSet();
  async function receivePreview(blob, promptId = currentPrompt) {
    if (!(blob instanceof Blob) || blob.size > 500000 || !promptId || promptId !== currentPrompt || seenPreviews.has(blob)) return;
    seenPreviews.add(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (promptId !== currentPrompt) return;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    preview = `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
    void sendProgress();
  }
  api.addEventListener?.("b_preview", event => receivePreview(event.detail));
  api.addEventListener?.("b_preview_with_metadata", event => receivePreview(event.detail?.blob,event.detail?.jobId));
  return { publishCatalog, publishPresence };
}
