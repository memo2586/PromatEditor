export function graphNodes(root) {
  const seen = new Set(), nodes = [];
  function visit(graph) {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const node of graph._nodes || graph.nodes || []) {
      nodes.push(node);
      if (node.subgraph) visit(node.subgraph);
    }
    const subgraphs = graph.subgraphs;
    if (subgraphs instanceof Map) for (const child of subgraphs.values()) visit(child);
  }
  visit(root);
  return nodes;
}

export function collectGroups(root) {
  const entries = [];
  for (const node of graphNodes(root)) {
    if (node.type !== "Fast Groups Bypasser (rgthree)") continue;
    node.refreshWidgets?.();
    const id = node.graph === root || !node.graph ? String(node.id) : `${node.graph.id}:${node.id}`;
    for (const widget of node.widgets || []) {
      if (typeof widget.doModeChange !== "function" || !widget.group) continue;
      entries.push({ node, widget, id, name: widget.group.title });
    }
  }
  return entries;
}

function descendants(node, result) {
  result.add(node);
  for (const child of node.subgraph?._nodes || node.subgraph?.nodes || []) descendants(child, result);
}

export function planGroups(parameters, entries) {
  if (!parameters.enabled) return [];
  const plan = [], desired = new Map();
  for (const row of parameters.groups) {
    const matches = entries.filter(e => e.name === row.name && (!row.bypasser_id || e.id === row.bypasser_id));
    if (!matches.length) throw new Error(`工作流缺少分组“${row.name}”，请在桌面编辑器重新读取工作流分组或删除该行。`);
    const unique = new Set(matches.map(e => e.widget.group));
    if (unique.size !== 1) throw new Error(`分组“${row.name}”重名，请重新读取分组以确定控制器。`);
    for (const entry of matches) {
      if (desired.has(entry.widget.group) && desired.get(entry.widget.group) !== row.enabled) {
        throw new Error(`分组“${row.name}”存在冲突的开关设置。`);
      }
      desired.set(entry.widget.group, row.enabled);
      plan.push({ ...entry, enabled: row.enabled });
    }
  }
  for (const node of new Set(entries.map(e => e.node))) {
    const restriction = node.properties?.toggleRestriction || "default";
    const states = entries.filter(e => e.node === node).map(e => desired.get(e.widget.group) ?? e.widget.toggled);
    const count = states.filter(Boolean).length;
    if ((restriction === "max one" && count > 1) || (restriction === "always one" && count !== 1)) {
      throw new Error(`控制器 ${node.id} 的 ${restriction} 限制与编辑器设置冲突。`);
    }
  }
  const affected = new Map();
  for (const change of plan) {
    change.widget.group.recomputeInsideNodes?.();
    const nodes = new Set();
    for (const child of change.widget.group._children || change.widget.group._nodes || []) {
      if (typeof child.mode === "number") descendants(child, nodes);
    }
    for (const node of nodes) {
      if (node.type === "PromptEditorPrompts" && !change.enabled) throw new Error("请将提示词编辑器节点移到被旁路的分组之外。");
      if (affected.has(node) && affected.get(node) !== change.enabled) throw new Error("相互重叠的分组开关冲突，请调整分组范围。");
      affected.set(node, change.enabled);
    }
  }
  return plan;
}

export function applyGroupPlan(plan) {
  for (const item of plan) item.widget.doModeChange(item.enabled, true);
}
