// Model overrides are scoped to the submitted prompt; the user's graph stays intact.
export const loaderTypes = {
  lora: ["Lora Loader (LoraManager)"],
  unet: ["UNETLoader", "Unet Loader (LoraManager)"],
  vae: ["VAELoader"],
};
const clone = value => JSON.parse(JSON.stringify(value));
const widget = (node, name) => node.widgets?.find(w => w.name === name);
const loraList = value => Array.isArray(value) ? value : Array.isArray(value?.__value__) ? value.__value__ : [];

export function collectModelNodes(graph) {
  // Root IDs have a stable one-to-one mapping to API prompt IDs.
  return (graph?._nodes || graph?.nodes || []).filter(n => Object.values(loaderTypes).some(types => types.includes(n.type))).map(n => ({
    node_id: String(n.id), node_type: n.type, title: n.title || n.type,
    model: widget(n, n.type === "VAELoader" ? "vae_name" : "unet_name")?.value || "",
    weight_dtype: widget(n, "weight_dtype")?.value || "default",
    loras: loraList(widget(n, "loras")?.value).map(row => ({ name: row.name, active: !!row.active,
      strength: Number(row.strength), clipStrength: Number(row.clipStrength ?? row.strength) })),
  }));
}

export function planModelOverrides(prompt, states, graph) {
  const changes = new Map(), nodes = graph?._nodes || graph?.nodes || [];
  for (const state of states) {
    const controls = state.generation?.model_controls;
    if (!controls) continue;
    for (const [kind, types] of Object.entries(loaderTypes)) {
      const control = controls[kind];
      if (!control?.enabled) continue;
      const id = String(control.node_id), node = nodes.find(n => String(n.id) === id), output = prompt.output?.[id];
      if (!node || node.type !== control.node_type || !types.includes(node.type) || output?.class_type !== node.type) {
        throw new Error(`目标节点 #${id} 不可用、已旁路或类型变化，请重新读取节点。`);
      }
      const fields = kind === "lora" ? { loras: clone(control.loras) }
        : kind === "unet" ? { unet_name: control.model, weight_dtype: control.weight_dtype } : { vae_name: control.model };
      for (const [name, value] of Object.entries(fields)) {
        if (node.inputs?.some(input => input.name === name && input.link != null)
            || (Array.isArray(output.inputs?.[name]) && output.inputs[name].length === 2 && typeof output.inputs[name][0] === "string" && Number.isInteger(output.inputs[name][1]))) {
          throw new Error(`节点 #${id} 的 ${name} 已接线，无法覆盖。请先断开该输入。`);
        }
        if (kind !== "lora") {
          const source = widget(node, name)?.options?.values;
          const values = typeof source === "function" ? source.call(widget(node, name)) : source;
          if (Array.isArray(values) && !values.includes(value)) throw new Error(`节点 #${id} 不支持模型或精度“${value}”，请刷新模型列表。`);
        }
        const key = `${id}/${name}`;
        if (changes.has(key) && JSON.stringify(changes.get(key).value) !== JSON.stringify(value)) throw new Error(`多个编辑器对节点 #${id} 的 ${name} 设置冲突。`);
        changes.set(key, { id, name, value, node });
      }
    }
  }
  return [...changes.values()];
}

export function applyModelOverrides(prompt, plan) {
  // Planning completes before any field is written, so a bad target changes nothing.
  for (const { id, name, value, node } of plan) {
    const inputs = prompt.output[id].inputs;
    const original = inputs[name];
    inputs[name] = name === "loras" && original && !Array.isArray(original) && "__value__" in original
      ? { ...original, __value__: clone(value) } : clone(value);
    const serialized = prompt.workflow?.nodes?.find(n => String(n.id) === id);
    const index = node.widgets?.findIndex(w => w.name === name);
    if (serialized?.widgets_values && Array.isArray(serialized.widgets_values) && index >= 0) serialized.widgets_values[index] = clone(inputs[name]);
  }
}

export function installModelControls(app, api) {
  if (app.__promptEditorModelsInstalled) return;
  app.__promptEditorModelsInstalled = true;
  const root = () => app.rootGraph || app.graph;
  let publishing = false;
  async function publishModelCatalog() {
    if (publishing) return;
    publishing = true;
    try {
      const graph = root(), hasBridge = (graph?._nodes || graph?.nodes || []).some(n => n.type === "PromptEditorPrompts" && n.mode !== 2 && n.mode !== 4);
      const response = await api.fetchApi("/prompt-editor/model-catalog", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: hasBridge ? collectModelNodes(graph) : [] }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) { console.warn("[Prompt Editor] 节点目录同步失败", error); }
    finally { publishing = false; }
  }
  const original = app.graphToPrompt;
  app.graphToPrompt = async function (graph = root(), ...args) {
    const prompt = await original.call(this, graph, ...args);
    const states = Object.values(prompt.workflow?.extra?.prompt_editor_snapshots || {});
    const plan = planModelOverrides(prompt, states, graph);
    applyModelOverrides(prompt, plan);
    return prompt;
  };
  return { publishModelCatalog };
}
