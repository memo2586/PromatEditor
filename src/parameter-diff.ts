import type { Generation, Project } from "./types";

export type ParameterChange = {
  label: string;
  from: string;
  to: string;
  text: string;
};
export function mappingChanges(
  from?: Record<string, string>,
  to?: Record<string, string>,
): ParameterChange[] {
  if (!from) return [];
  return [...new Set([...Object.keys(from), ...Object.keys(to || {})])]
    .sort()
    .flatMap((key) =>
      from[key] === to?.[key]
        ? []
        : [
            {
              label: `工作流映射 · ${key}`,
              from: from[key] || "无",
              to: to?.[key] || "无",
              text: `工作流映射 · ${key} ${from[key] || "无"} → ${to?.[key] || "无"}`,
            },
          ],
    );
}
const display = (v: unknown): string => {
  if (v == null || v === "") return "无";
  if (typeof v === "boolean") return v ? "开启" : "关闭";
  if (Array.isArray(v)) return v.map(display).join("；") || "无";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("name" in o)
      return "strength" in o
        ? `${o.name} · 模型权重 ${o.strength} · CLIP 权重 ${o.clipStrength} · ${display(o.active)}`
        : `${o.name} · ${display(o.enabled)} · 目标 ${display(o.bypasser_id)}`;
    return JSON.stringify(v);
  }
  return String(v);
};
export function parameterChanges(
  from: Generation,
  to: Generation,
): ParameterChange[] {
  const out: ParameterChange[] = [];
  const add = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      out.push({
        label,
        from: display(a),
        to: display(b),
        text: `${label} ${display(a)} → ${display(b)}`,
      });
  };
  for (const [key, label] of Object.entries({
    enabled: "参数同步",
    seed: "Seed",
    seed_control: "Seed 控制",
    steps: "Steps",
    cfg: "CFG",
    sampler: "采样器",
    width: "宽度",
    height: "高度",
    batch_size: "批量",
  }))
    add(label, from[key as keyof Generation], to[key as keyof Generation]);
  const array = (
    label: string,
    a: { name: string }[] = [],
    b: { name: string }[] = [],
  ) => {
    if (a.length === b.length && a.every((x, i) => x.name === b[i].name))
      a.forEach((x, i) => add(`${label} · ${x.name}`, x, b[i]));
    else add(label, a, b);
  };
  array("工作流分组", from.groups, to.groups);
  array(
    "LoRA 模型与权重",
    from.model_controls?.lora.loras,
    to.model_controls?.lora.loras,
  );
  for (const [key, label] of Object.entries({
    lora: "LoRA",
    unet: "UNet",
    vae: "VAE",
  })) {
    const a = from.model_controls?.[key as "lora" | "unet" | "vae"],
      b = to.model_controls?.[key as "lora" | "unet" | "vae"];
    for (const [field, name] of Object.entries({
      enabled: "控制",
      node_id: "节点",
      node_type: "节点类型",
      model: "模型",
      weight_dtype: "权重类型",
    }))
      add(
        `${label} · ${name}`,
        a?.[field as keyof typeof a],
        b?.[field as keyof typeof b],
      );
  }
  return out;
}

export function belongsToProject(
  run: {
    project_path?: string | null;
    session_id?: string;
    snapshot: { project_id?: string };
  },
  project: Project,
  path: string | null,
  session?: string,
) {
  if (
    path &&
    path.replaceAll("\\", "/").toLowerCase() ===
      run.project_path?.replaceAll("\\", "/").toLowerCase()
  )
    return true;
  if (project.Id && run.snapshot.project_id)
    return project.Id === run.snapshot.project_id;
  if (path) return false;
  return !run.project_path && !!session && run.session_id === session;
}
