import type { Workspace } from "./types";
export type DragPayload = { ids?: string[]; group?: string };
export type SortIntent = {
  method: "editor.move" | "editor.group.move";
  payload: {
    ids?: string[];
    id?: string;
    target: string;
    after: boolean;
    group?: string | null;
    block?: string;
  };
};

// A display-only projection. Source text, undo history and persistence are only
// updated by the existing RPC once the pointer is released.
export function previewSort(base: Workspace, intent: SortIntent): Workspace {
  const p = intent.payload;
  const groups = base.Groups.map((g) => ({ ...g, Members: [...g.Members] }));
  const flatten = (layout: string[]) => {
    const owned = new Set(groups.flatMap((g) => g.Members));
    const ids = layout.flatMap((k) =>
      k.startsWith("group:")
        ? groups.find((g) => `group:${g.Id}` === k)?.Members || []
        : owned.has(k)
          ? []
          : [k],
    );
    const terms = new Map(base.Active.map((t) => [t.Id, t]));
    const active = ids.flatMap((id) => (terms.has(id) ? [terms.get(id)!] : []));
    return {
      ...base,
      Groups: groups.filter((g) => g.Members.length),
      Layout: layout,
      Active: [...active, ...base.Active.filter((t) => !ids.includes(t.Id))],
    };
  };
  if (intent.method === "editor.group.move") {
    const key = `group:${p.id}`;
    if (p.target === key) return base;
    const layout = base.Layout.filter((k) => k !== key);
    const at = layout.indexOf(p.target);
    layout.splice(at < 0 ? layout.length : at + Number(p.after), 0, key);
    return flatten(layout);
  }
  const moving = new Set(p.ids);
  if (moving.has(p.target)) return base;
  const terms = base.Active.filter((t) => moving.has(t.Id));
  for (const g of groups) g.Members = g.Members.filter((id) => !moving.has(id));
  if (!p.group && !p.target && p.block && base.Layout.includes(p.block)) {
    const layout = base.Layout.filter((k) => !moving.has(k));
    layout.splice(
      layout.indexOf(p.block) + Number(p.after),
      0,
      ...terms.map((t) => t.Id),
    );
    return flatten(layout);
  }
  const rest = base.Active.filter((t) => !moving.has(t.Id));
  let at = rest.findIndex((t) => t.Id === p.target);
  at = at < 0 ? rest.length : at + Number(p.after);
  if (p.group) {
    const g = groups.find((g) => g.Id === p.group);
    if (!g) return base;
    const pos = g.Members.indexOf(p.target);
    g.Members.splice(
      pos < 0 ? g.Members.length : pos + Number(p.after),
      0,
      ...terms.map((t) => t.Id),
    );
    if (!p.target) {
      const end = rest.map((t) => g.Members.includes(t.Id)).lastIndexOf(true);
      if (end >= 0) at = end + 1;
    }
  } else {
    const owner = groups.find((g) => g.Members.includes(p.target));
    if (owner)
      at = p.after
        ? rest.map((t) => owner.Members.includes(t.Id)).lastIndexOf(true) + 1
        : rest.findIndex((t) => owner.Members.includes(t.Id));
  }
  rest.splice(at, 0, ...terms);
  const layout = [
    ...new Set(
      rest.map((t) => {
        const g = groups.find((g) => g.Members.includes(t.Id));
        return g ? `group:${g.Id}` : t.Id;
      }),
    ),
  ];
  for (const g of groups.filter((g) => g.Members.length)) {
    const key = `group:${g.Id}`;
    if (!layout.includes(key)) {
      const oldIndex = base.Layout.indexOf(key);
      const prev = base.Layout.slice(0, oldIndex)
        .reverse()
        .find((k) => layout.includes(k));
      const next = base.Layout.slice(oldIndex + 1).find((k) =>
        layout.includes(k),
      );
      layout.splice(
        prev
          ? layout.indexOf(prev) + 1
          : next
            ? layout.indexOf(next)
            : layout.length,
        0,
        key,
      );
    }
  }
  return {
    ...base,
    Active: rest,
    Groups: groups.filter((g) => g.Members.length),
    Layout: layout,
  };
}
