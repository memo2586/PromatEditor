import { tr } from "./i18n";
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
              label: tr("工作流映射 · {0}", key),
              from: from[key] || tr("无"),
              to: to?.[key] || tr("无"),
              text: tr("工作流映射 · {0} {1} → {2}", key, from[key] || tr("无"), to?.[key] || tr("无")),
            },
          ],
    );
}
const display = (v: unknown): string => {
  if (v == null || v === "") return tr("无");
  if (typeof v === "boolean") return v ? tr("开启") : tr("关闭");
  if (Array.isArray(v)) return v.map(display).join("；") || tr("无");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("name" in o)
      return "strength" in o
        ? tr("{0} · 模型权重 {1} · CLIP 权重 {2} · {3}", o.name, o.strength, o.clipStrength, display(o.active))
        : tr("{0} · {1} · 目标 {2}", o.name, display(o.enabled), display(o.bypasser_id));
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
    enabled: tr("参数同步"),
    seed: "Seed",
    seed_control: tr("Seed 控制"),
    steps: "Steps",
    cfg: "CFG",
    sampler: tr("采样器"),
    width: tr("宽度"),
    height: tr("高度"),
    batch_size: tr("批量"),
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
  array(tr("工作流分组"), from.groups, to.groups);
  array(
    tr("LoRA 模型与权重"),
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
      enabled: tr("控制"),
      node_id: tr("节点"),
      node_type: tr("节点类型"),
      model: tr("模型"),
      weight_dtype: tr("权重类型"),
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
