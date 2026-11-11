import { CollapsibleGroup, useTermPageMotion } from "./editor-motion";
import { usePointerSort } from "./pointer-sort";
import type { Workspace } from "./types";
import { useListMotion } from "./motion";
import { openProbe } from "./comfy-probe";
import { caretPosition } from "./caret-position";
import { GenerateButton } from "./comfy-link";
import { rememberPromptSelection } from "./prompt-insertion";
import { useEffect, useLayoutEffect, useRef, useState, useMemo, type MouseEvent } from "react";
import {
  FloppyDisk,
  ArrowUUpLeft,
  ArrowUUpRight,
  PushPin,
  ArrowsIn,
  ArrowsOut,
  MagnifyingGlass,
  DotsThree,
  Copy,
  Eye,
  Plus,
  Star,
  Minus,
  ArrowCounterClockwise,
  EyeSlash,
  ArrowSquareOut,
  Crosshair,
  Trash,
  X,
  CaretDown,
  CaretRight,
  DotsSixVertical,
  TextAlignLeft,
  ArrowDown,
  ArrowUp,
  CheckCircle,
} from "@phosphor-icons/react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useApp } from "./context";
import {
  IconButton,
  Panel,
  Segments,
  Modal,
  Field,
  Menu,
  Empty,
  Notice,
  type MenuItem,
} from "./ui";
import { rpc } from "./api";
import {
  categories,
  type Term,
  type Group,
  type Lexeme,
  type Favorite,
} from "./types";
const display = (t: Term) =>
  t.Group && t.Kind === "normal" ? `(${t.Base}:${t.Weight})` : t.Raw;
export function GroupForm({
  ids,
  group,
  onClose,
}: {
  ids: string[];
  group?: Group;
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState(group?.Name || "");
  const [category, setCategory] = useState(group?.Category || "Extra");
  const [description, setDescription] = useState(group?.Description || "");
  const [error, setError] = useState("");
  const w =
    app.data.project.State[
      app.data.project.State.IsNegative ? "Negative" : "Positive"
    ];
  const terms = w.Active.filter((t) => ids.includes(t.Id));
  const body = terms.map(display).join(", ");
  const save = async () => {
    try {
      await app.act(group ? "editor.group.edit" : "editor.group", {
        ids,
        id: group?.Id,
        name,
        category,
        description,
      });
      if (!group && app.data.settings.AutoCollapseNewGroups) {
        const state = await rpc<any>("state.get");
        const g = state.project.State[
          state.project.State.IsNegative ? "Negative" : "Positive"
        ].Groups.find((g: Group) => g.Members.includes(ids[0]));
        if (g)
          await app.act("settings.set", {
            value: {
              ...app.data.settings,
              CollapsedGroups: [...app.data.settings.CollapsedGroups, g.Id],
            },
          });
      }
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Modal
      title={group ? "修改视觉组" : "创建视觉组"}
      onClose={onClose}
      width={680}
      footer={
        <>
          <span className="hint">{terms.length} 个有效成员</span>
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>
            {group ? "保存修改" : "创建视觉组"}
          </button>
        </>
      }
    >
      <div className="group-form-fields">
        <Field label="组名（可选）">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="为这组词条起一个名字"
          />
        </Field>
        <Field label="自然语言描述（可选）">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="例如：On the left"
          />
        </Field>
        <Field label="类别">
          <div className="category-grid">
            {categories.map((c) => (
              <button
                key={c}
                className={`category-chip cat-${c.toLowerCase()} ${category === c ? "chosen" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
        <Field label="输出预览 · 实时更新">
          <pre className="output-preview">
            {description.trim()
              ? `${description.trim()}${/[:：]$/.test(description.trim()) ? " " : ": "}${body.replace(/[.。]\s*$/, "")}.`
              : body || "请选择要归组的有效词条"}
          </pre>
        </Field>
        <Notice>
          组名和类别仅用于整理；描述随复制和 Bridge
          输出。修改组时保留成员与权重。
        </Notice>
      </div>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
export function FavoriteForm({
  favorite,
  text,
  ids,
  onClose,
}: {
  favorite?: Favorite;
  text?: string;
  ids?: string[];
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState(favorite?.Name || "");
  const [category, setCategory] = useState(favorite?.Category || "Extra");
  const [raw, setRaw] = useState(favorite?.Text || text || "");
  const [error, setError] = useState("");
  return (
    <Modal
      title={favorite ? "编辑收藏片段" : "收藏选中片段"}
      width={680}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                ids?.length
                  ? await app.act("favorites.createSelection", {
                      ids,
                      name,
                      category,
                    })
                  : await app.act("favorites.save", {
                      value: {
                        Id: favorite?.Id || "",
                        Name: name,
                        Category: category,
                        Text: raw,
                        Images: favorite?.Images || [],
                      },
                    });
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            保存收藏
          </button>
        </>
      }
    >
      <Field label="收藏名称">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="类别">
        <div className="category-grid">
          {categories.map((c) => (
            <button
              key={c}
              className={`category-chip cat-${c.toLowerCase()} ${category === c ? "chosen" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>
      <Field label="提示词原文">
        <textarea
          rows={7}
          readOnly={!!ids?.length}
          className="mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </Field>
      <p className="hint">收藏片段与插入后的视觉组分别保存，互不影响。</p>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function TermForm({ term, onClose }: { term: Term; onClose: () => void }) {
  const app = useApp();
  const [text, setText] = useState(term.Base);
  const [weight, setWeight] = useState(String(term.Weight));
  const [error, setError] = useState("");
  return (
    <Modal
      title="编辑词条"
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={!term.Editable}
            onClick={async () => {
              try {
                const n = Number(weight);
                if (!weight.trim() || !Number.isFinite(n))
                  throw Error("权重必须是有限十进制数");
                const raw =
                  term.Kind === "lora"
                    ? term.Raw.replace(/:[^:>]+>$/, `:${weight}>`)
                    : term.Weighted || n !== 1
                      ? `(${text}:${weight})`
                      : text;
                await app.act("editor.insert", {
                  text: raw,
                  start: term.Start,
                  length: term.Length,
                  completion: true,
                });
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            保存词条
          </button>
        </>
      }
    >
      <Field label="原文">
        <textarea
          rows={4}
          value={text}
          readOnly={!term.Editable || term.Kind === "lora"}
          onChange={(e) => setText(e.target.value)}
          className="mono"
        />
      </Field>
      <Field label="权重">
        <input
          type="number"
          step="0.1"
          value={weight}
          readOnly={!term.Editable}
          onChange={(e) => setWeight(e.target.value)}
        />
      </Field>
      {!term.Editable && (
        <Notice>复杂或语义不明确的语法仅支持在原文区域编辑。</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
export function EditorPage() {
  const app = useApp();
  const state = app.data.project.State;
  const negative = state.IsNegative;
  const w = negative ? state.Negative : state.Positive;
  const [draft, setDraft] = useState(w.Text);
  const draftRef = useRef(w.Text);
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  const completionPopup = useRef<HTMLDivElement>(null);
  // List navigation mirrors a range into the source without replacing batch selection.
  const sourceSelectionProgrammatic = useRef(false);
  const completionSelection = useRef<{
    text: string; caret: number; negative: boolean; scrollTop: number; scrollLeft: number;
  } | null>(null);
  useLayoutEffect(() => {
    const selection = completionSelection.current;
    const input = source.current;
    if (selection && selection.negative !== negative) completionSelection.current = null;
    if (!selection || !input || selection.negative !== negative || selection.text !== draft) return;
    completionSelection.current = null;
    sourceSelectionProgrammatic.current = true;
    input.focus({ preventScroll: true });
    input.setSelectionRange(selection.caret, selection.caret);
    input.scrollTop = selection.scrollTop;
    input.scrollLeft = selection.scrollLeft;
  });
  const sourceScroll = useRef<HTMLDivElement>(null);
  const sourceHighlights = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([]);
  const sourceLines = useMemo(() => {
    let offset = 0;
    return draft.split("\n").map((line) => {
      const at = offset;
      offset += line.length + 1;
      return { line, at };
    });
  }, [draft]);
  useEffect(() => {
    const mirror = sourceHighlights.current;
    if (!mirror) return;
    const measure = () => {
      if (source.current) {
        const styles = getComputedStyle(source.current);
        mirror.style.width = `${source.current.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight)}px`;
        mirror.style.right = "auto";
      }
      const next = Array.from(
        mirror.children,
        (el) => el.getBoundingClientRect().height,
      );
      setLineHeights((old) =>
        old.length === next.length && old.every((n, i) => n === next[i])
          ? old
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(mirror);
    if (source.current) observer.observe(source.current);
    measure();
    return () => observer.disconnect();
  }, [draft]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  useLayoutEffect(() => { rememberPromptSelection(negative, selected); }, [negative, selected]);
  const groupClickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const groupClickSelection = useRef<{ selected: string[]; anchor: string | null; committed: boolean } | null>(null);
  useEffect(() => () => clearTimeout(groupClickTimer.current), [negative]);
  const [collapsed, setCollapsed] = useState(app.data.settings.CollapsedGroups);
  const collapsedRef = useRef(collapsed);
  const savingCollapsed = useRef(false);
  const settingsRef = useRef(app.data.settings);
  settingsRef.current = app.data.settings;
  useEffect(() => {
    if (!savingCollapsed.current) {
      collapsedRef.current = app.data.settings.CollapsedGroups;
      setCollapsed(collapsedRef.current);
    }
  }, [app.data.settings.CollapsedGroups]);
  const [hiddenRatio, setHiddenRatio] = useState<number | null>(null);
  const sourceResize = useRef(false);
  const [batchWeight, setBatchWeight] = useState("1.2");
  const anchor = useRef<string | null>(null);
  const [dragPreview, setDragPreview] = useState<Workspace | null>(null);
  const termListRef = useRef<HTMLDivElement>(null);
  const visualWorkspace = dragPreview || w;
  useListMotion(termListRef, "[data-motion-id]:not([data-motion-exit]):not([data-motion-exit] *)", [visualWorkspace.Layout.join("|"), (hidden ? w.Hidden : visualWorkspace.Active).map(t => t.Id).join("|")].join("/"), negative+":"+hidden+":"+query+":"+filter+":"+collapsed.join("|"), 180, Infinity, true, true, false);
  const captureTermPage = useTermPageMotion(termListRef, hidden, negative);
  const [lookup, setLookup] = useState(false);
  const [lookupTab,setLookupTab]=useState('lexicon');
  const [lookupSelected,setLookupSelected]=useState(0);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupItems, setLookupItems] = useState<Lexeme[]>([]);
  const [completion, setCompletion] = useState<{
    items: Lexeme[];
    caret: number;
    at: number;
    length: number;
    index: number;
    left: number;
    top: number;
  } | null>(null);
  const composition = useRef(false);
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const cancelPointerDrag = usePointerSort(
    termListRef, app.data.valid && !hidden && !query && filter === "all", w,
    setDragPreview, async intent => { await safe(intent.method, intent.payload); },
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [split, setSplit] = useState<{ width?: number; height?: number }>({});
  const splitDrag = useRef(false);
  const serial = useRef(0);
  const workspaceUi = useRef<
    Record<
      string,
      { query: string; filter: string; hidden: boolean; selected: string[] }
    >
  >({});
  const oldWorkspace = useRef(negative ? "negative" : "positive");
  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) {
      pending.current = false;
      const result = await rpc<any>("editor.text", { text: draftRef.current });
      await app.refresh();
      if (result.error) setCompletion(null);
    }
  };
  app.flush.current = flush;
  useEffect(() => {
    const key = negative ? "negative" : "positive";
    if (oldWorkspace.current !== key) {
      workspaceUi.current[oldWorkspace.current] = {
        query,
        filter,
        hidden,
        selected,
      };
      const ui = workspaceUi.current[key];
      setQuery(ui?.query || "");
      setFilter(ui?.filter || "all");
      setHidden(ui?.hidden || false);
      setSelected(ui?.selected || []);
      oldWorkspace.current = key;
      setDraft(w.Text);
      draftRef.current = w.Text;
      pending.current = false;
      setCompletion(null);
      requestAnimationFrame(() => {
        if (source.current) {
          sourceSelectionProgrammatic.current = true;
          source.current.selectionStart = source.current.selectionEnd = w.Caret;
          source.current.scrollTop = w.Scroll;
        }
      });
    } else if (!pending.current && draftRef.current !== w.Text) {
      setDraft(w.Text);
      draftRef.current = w.Text;
    }
  }, [w.Text, negative]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const valid = new Set([...w.Active, ...w.Hidden].map((t) => t.Id));
    w.Groups.forEach((g) => valid.add(`group:${g.Id}`));
    setSelected((prev) => prev.filter((id) => valid.has(id)));
  }, [w.Active, w.Hidden]);
  const safe = async (method: string, payload?: unknown) => {
    try {
      return await app.act<any>(method, payload);
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const mirrorSourceCaret = (term: Term) => {
    const textarea = source.current;
    if (!textarea) return;
    const { scrollTop, scrollLeft } = textarea;
    sourceSelectionProgrammatic.current = true;
    textarea.setSelectionRange(term.Start, term.Start);
    textarea.focus({ preventScroll: true });
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = scrollLeft;
    for (const layer of sourceScroll.current?.querySelectorAll<HTMLElement>(".line-numbers,.source-highlights") || [])
      layer.style.transform = `translateY(-${scrollTop}px)`;
  };
  const select = (
    id: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    toggle = true,
  ) => {
    clearTimeout(groupClickTimer.current);
    const at = visible.findIndex((t) => t.Id === id);
    if (e.shiftKey && anchor.current) {
      const from = visible.findIndex((t) => t.Id === anchor.current);
      const range = visible
        .slice(Math.min(from, at), Math.max(from, at) + 1)
        .map((t) => t.Id);
      setSelected(
        e.ctrlKey || e.metaKey ? [...new Set([...selected, ...range])] : range,
      );
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
      );
      anchor.current = id;
    } else {
      if (toggle && selected.length === 1 && selected[0] === id) {
        setSelected([]); anchor.current = null;
        termListRef.current?.focus({ preventScroll: true });
        return;
      }
      setSelected([id]); anchor.current = id;
    }
    const term = w.Active.find((t) => t.Id === id);
    if (term) mirrorSourceCaret(term);
  };
  const selectGroup = (
    g: Group,
    e?: { ctrlKey: boolean; metaKey: boolean },
  ) => {
    const memberIds = (hidden ? w.Hidden : w.Active)
      .filter((t) => g.Members.includes(t.Id))
      .map((t) => t.Id);
    const groupKey = `group:${g.Id}`;
    if (e && (e.ctrlKey || e.metaKey)) {
      setSelected((prev) => {
        const hasAll =
          memberIds.length > 0 && memberIds.every((id) => prev.includes(id));
        const hasGroupKey = prev.includes(groupKey);
        if (hasAll || hasGroupKey) {
          return prev.filter(
            (id) => !memberIds.includes(id) && id !== groupKey,
          );
        } else {
          return [...prev, ...memberIds, groupKey];
        }
      });
    } else {
      if (selected.includes(groupKey)) {
        setSelected([]); anchor.current = null;
        termListRef.current?.focus({ preventScroll: true });
        return;
      }
      setSelected([...memberIds, groupKey]);
      anchor.current = memberIds[0] || groupKey;
    }
    const firstTerm = w.Active.find((t) => g.Members.includes(t.Id));
    if (firstTerm) mirrorSourceCaret(firstTerm);
  };
  const match = (t: Term) => {
    const q = query.trim().toLowerCase();
    return (
      (!q ||
        `${t.Raw}\n${t.Base}\n${app.data.matches[t.Id]?.Translation || ""}`
          .toLowerCase()
          .includes(q)) &&
      (filter === "all" ||
        (filter === "lora" && t.Kind === "lora") ||
        (filter === "weighted" && t.Weighted) ||
        (filter === "unmatched" && !app.data.matches[t.Id]))
    );
  };
  const visible = useMemo(
    () => (hidden ? w.Hidden : w.Active).filter(match),
    [w, hidden, query, filter, app.data.matches],
  );
  const selectedTerms = (hidden ? w.Hidden : w.Active).filter((t) =>
    selected.includes(t.Id),
  );
  const activeSelected = w.Active.filter((t) => selected.includes(t.Id));
  useEffect(() => {
    if (selectedTerms.length > 0) {
      const wVal = selectedTerms[0].Weight;
      const formatted = Number.isInteger(wVal)
        ? wVal.toFixed(1)
        : String(Math.round(wVal * 100) / 100);
      setBatchWeight(formatted);
    }
  }, [selected, w.Active, hidden]);
  const duplicateKeys = useMemo(() => {
    const keys: Record<string, Term[]> = {};
    w.Active.filter((t) => t.Kind === "normal").forEach((t) =>
      (keys[t.Key] ??= []).push(t),
    );
    return Object.values(keys).filter((ts) => ts.length > 1);
  }, [w.Active]);
  const groupForm = (group?: Group, ids = activeSelected.map((t) => t.Id)) =>
    app.modal(
      <GroupForm
        ids={group?.Members || ids}
        group={group}
        onClose={() => app.modal(null)}
      />,
    );
  const favoriteForm = (full = false) => {
    const text = full
      ? w.Active.map(display).join(", ")
      : activeSelected.map(display).join(", ");
    app.modal(
      <FavoriteForm
        text={text}
        ids={(full ? w.Active : activeSelected).map((t) => t.Id)}
        onClose={() => app.modal(null)}
      />,
    );
  };
  const copy = async () => {
    try {
      const text = await app.act<string>("editor.copy");
      await navigator.clipboard.writeText(text);
      app.notify(
        `已复制${negative ? "消极" : "积极"}提示词的全部 ${w.Active.length} 个有效项`,
      );
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const locate = () => {
    const t = activeSelected[0];
    if (!t || !source.current) return;
    setShowSource(true);
    requestAnimationFrame(() => {
      sourceSelectionProgrammatic.current = true;
      source.current!.focus();
      source.current!.setSelectionRange(t.Start, t.Start + t.Length);
      const line = draft.slice(0, t.Start).split("\n").length - 1;
      source.current!.scrollTop = Math.max(0, line * 30 - 60);
    });
  };
  const setCollapsedGroups = async (next: string[]) => {
    collapsedRef.current = next;
    setCollapsed(next);
    if (savingCollapsed.current) return;
    savingCollapsed.current = true;
    try {
      // Keep the latest local intent while an older settings response is in flight.
      let saved: string[];
      do {
        saved = collapsedRef.current;
        await app.act("settings.set", {
          value: { ...settingsRef.current, CollapsedGroups: saved },
        });
      } while (saved !== collapsedRef.current);
    } catch (error) {
      collapsedRef.current = settingsRef.current.CollapsedGroups;
      setCollapsed(collapsedRef.current);
      app.reportError(String(error));
    } finally {
      savingCollapsed.current = false;
    }
  };
  const toggleGroup = (g: Group) => setCollapsedGroups(
    collapsedRef.current.includes(g.Id)
      ? collapsedRef.current.filter((id) => id !== g.Id)
      : [...collapsedRef.current, g.Id],
  );
  const termMenu = (t: Term, e: MouseEvent) => {
    e.preventDefault();
    if (!selected.includes(t.Id)) setSelected([t.Id]);
    const target = selected.includes(t.Id) ? selected : [t.Id];
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "试试该词条的效果…",
          disabled: hidden,
          action: () => openProbe(t.Id,"weight",app.data.project.State.IsNegative),
        },
        {
          label: "编辑词条…",
          action: () =>
            app.modal(<TermForm term={t} onClose={() => app.modal(null)} />),
        },
        {
          label: "定位原文",
          disabled: hidden,
          action: () => {
            setSelected([t.Id]);
            sourceSelectionProgrammatic.current = true;
            source.current?.focus();
            source.current?.setSelectionRange(t.Start, t.Start + t.Length);
          },
        },
        {
          label: hidden ? "恢复所选项" : "隐藏所选项",
          action: () =>
            safe(hidden ? "editor.restore" : "editor.hide", { ids: target }),
        },
        {
          label: "取消权重",
          disabled: hidden || !t.Editable,
          action: () => safe("editor.weight", { ids: target, value: null }),
        },
        {
          label: "创建视觉组…",
          disabled: hidden,
          action: () => groupForm(undefined, target),
        },
        {
          label: "移出视觉组",
          disabled: hidden,
          action: () => safe("editor.detach", { ids: target }),
        },
        { separator: true, label: "" },
        {
          label: "删除所选项",
          danger: true,
          action: () => safe("editor.delete", { ids: target }),
        },
      ],
    });
  };
  const groupMenu = (g: Group, e: MouseEvent) => {
    e.preventDefault();
    const active = g.Members.filter((id) => w.Active.some((t) => t.Id === id));
    const inactive = g.Members.filter((id) =>
      w.Hidden.some((t) => t.Id === id),
    );
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: collapsed.includes(g.Id) ? "展开组" : "收起组",
          action: () => toggleGroup(g),
        },
        {
          label: "选择整组有效项",
          disabled: !active.length,
          action: () => setSelected(active),
        },
        { label: "修改组名 / 类别 / 描述…", action: () => groupForm(g) },
        {
          label: "隐藏整组有效项",
          disabled: !active.length,
          action: () => safe("editor.hide", { ids: active }),
        },
        {
          label: "恢复隐藏成员",
          disabled: !inactive.length,
          action: () => safe("editor.restore", { ids: inactive }),
        },
        { separator: true, label: "" },
        {
          label: "解散组（保留词条）",
          action: () => safe("editor.group.dissolve", { id: g.Id }),
        },
        {
          label: "删除整组（含隐藏成员）",
          danger: true,
          action: async () => {
            if (
              (await app.confirm({
                title: "删除整个视觉组？",
                body: (
                  <p>
                    “{g.Name || g.Category}”的 {g.Members.length}{" "}
                    个成员（含隐藏项）将被删除，可通过撤销恢复。
                  </p>
                ),
                confirm: "删除整组",
                danger: true,
              })) === "confirm"
            )
              await safe("editor.group.delete", { id: g.Id });
          },
        },
      ],
    });
  };
  const completionSearch = async (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const boundary = Math.max(
      before.lastIndexOf(","),
      before.lastIndexOf("\n"),
      before.lastIndexOf(";"),
      before.lastIndexOf("，"),
    );
    let at = boundary + 1;
    while (at < caret && /[\s(]/.test(text[at])) at++;
    let end = caret;
    while (end < text.length && !/[,;，；\n)]/.test(text[end])) end++;
    const colon = text.slice(at, end).lastIndexOf(":");
    if (colon >= 0) end = at + colon;
    const q = text.slice(at, Math.min(caret, end)).trim();
    const version = ++serial.current;
    if (q.length < 2 || q.startsWith("<")) {
      setCompletion(null);
      return;
    }
    try {
      const items = await rpc<Lexeme[]>("lexicon.search", { text: q });
      if (version !== serial.current || composition.current || !items.length)
        return;
      const input = source.current;
      if (!input || document.activeElement !== input || input.value !== text || input.selectionStart !== caret) return;
      const anchor = caretPosition(input, caret);
      setCompletion({ items: items.slice(0, 12), caret, at, length: end - at, index: 0,
        left: Math.max(8, Math.min(anchor.left, innerWidth - 312)),
        top: anchor.top + anchor.height + 4 });
    } catch {
      setCompletion(null);
    }
  };
  useLayoutEffect(() => {
    if (!completion || !source.current || !completionPopup.current) return;
    const input = source.current;
    const popup = completionPopup.current;
    const position = () => {
      const anchor = caretPosition(input, input.selectionStart);
      const rect = input.getBoundingClientRect();
      if (anchor.top + anchor.height < rect.top || anchor.top > rect.bottom) {
        setCompletion(null); return;
      }
      const height = popup.offsetHeight;
      const top = anchor.top + anchor.height + 4 + height <= innerHeight - 8
        ? anchor.top + anchor.height + 4 : Math.max(8, anchor.top - height - 4);
      popup.style.left = Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8)) + 'px';
      popup.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + 'px';
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(input); observer.observe(popup);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [completion]);
  const chooseCompletion = async (i: number) => {
    if (!completion || composition.current) return;
    const item = completion.items[i];
    const { at, length } = completion;
    const input = source.current;
    if (!input) return;
    // React moves the caret to the end when the controlled textarea value changes.
    // Restore it after the completed text has actually reached the DOM.
    completionSelection.current = {
      text: draftRef.current.slice(0, at) + item.Text + draftRef.current.slice(at + length),
      caret: at + item.Text.length,
      negative,
      scrollTop: input.scrollTop,
      scrollLeft: input.scrollLeft,
    };
    setCompletion(null);
    serial.current++;
    try {
      await app.act("editor.insert", {
        text: item.Text,
        start: at,
        length,
        completion: true,
      });
    } catch (e) {
      completionSelection.current = null;
      app.reportError(String(e));
    }
  };
  useEffect(() => {
    if (!lookup) return;
    let alive = true;
    const t = setTimeout(() => {
      void rpc<Lexeme[]>("lexicon.search", { text: lookupQuery })
        .then((v) => {
          if (alive) setLookupItems(v);
        })
        .catch((e) => app.reportError(String(e)));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [lookupQuery, lookup]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        document.querySelector('[role="dialog"]') ||
        !["positive", "negative"].includes(app.page) ||
        e.isComposing
      )
        return;
      const mod = e.ctrlKey || e.metaKey;
      const isText = ["TEXTAREA", "INPUT"].includes(
        (e.target as HTMLElement).tagName,
      );
      if (mod && !e.shiftKey && !e.altKey && ["d", "x"].includes(e.key.toLowerCase()) && selected.length) {
        const element = e.target as HTMLElement;
        const raw = source.current;
        const editingText = element.isContentEditable || element.tagName === "SELECT"
          || (isText && (element !== raw || (raw && raw.selectionStart !== raw.selectionEnd)));
        if (!editingText) {
          const deleting = e.key.toLowerCase() === "d";
          const ids = new Set(selectedTerms.map((t) => t.Id));
          for (const group of w.Groups) if (selected.includes(`group:${group.Id}`)) {
            for (const id of group.Members) if (deleting || (!hidden && w.Active.some((t) => t.Id === id))) ids.add(id);
          }
          if (ids.size && (deleting || !hidden)) {
            e.preventDefault();
            void safe(deleting ? "editor.delete" : "editor.hide", { ids: [...ids] }).then((result) => { if (result) setSelected([]); });
            return;
          }
        }
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void copy();
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void safe("editor.undo");
      }
      if (
        mod &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        void safe("editor.redo");
      }
      if (mod && ["ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        let target = activeSelected.map((t) => t.Id);
        if (isText && source.current) {
          const t = w.Active.find(
            (t) =>
              source.current!.selectionStart >= t.Start &&
              source.current!.selectionStart <= t.Start + t.Length,
          );
          if (t) target = [t.Id];
        }
        if (target.length)
          void safe("editor.weight", {
            ids: target,
            value: app.data.settings.Step * (e.key === "ArrowUp" ? 1 : -1),
            relative: true,
          });
      }
      if (e.key === "Escape") {
        setCompletion(null);
        setDragging(false);
        cancelPointerDrag();
        setMenu(null);
        if (!isText) setSelected([]);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selected, w, app.page, app.data.settings]);
  const dragAllowed = app.data.valid && !hidden && !query && filter === "all";
  const drop = (
    e: React.DragEvent,
    target: string,
    group: string | null,
    block?: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const gid = e.dataTransfer.getData("application/prompt-group");
    const terms = e.dataTransfer.getData("application/prompt-terms");
    const after =
      e.clientY >
      e.currentTarget.getBoundingClientRect().top +
        e.currentTarget.getBoundingClientRect().height / 2;
    if (gid) {
      void safe("editor.group.move", {
        id: gid,
        target: block || target,
        after,
      });
    } else if (terms) {
      void safe("editor.move", {
        ids: JSON.parse(terms),
        target,
        group,
        after,
        block,
      });
    }
  };
  const row = (t: Term, group?: Group) => (
    <div
      key={t.Id}
      role="row"
      aria-selected={selected.includes(t.Id)}
      className={`term-row ${group ? "member" : ""} ${selected.includes(t.Id) ? "is-selected" : ""} ${!t.Editable ? "readonly" : ""}`}
      data-motion-id={`term:${t.Id}`}
      data-term-id={t.Id}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button,input,.term-handle")) e.preventDefault();
      }}
      onClick={(e) => select(t.Id, e)}
      onDoubleClick={() =>
        app.modal(<TermForm term={t} onClose={() => app.modal(null)} />)
      }
      onContextMenu={(e) => termMenu(t, e)}
      onDragOver={(e) => {
        if (dragAllowed) e.preventDefault();
      }}
      onDrop={(e) => {
        if (dragAllowed)
          drop(e, t.Id, group?.Id || null, group ? `group:${group.Id}` : t.Id);
      }}
    >
      <span className="selection-rail" />
      <span className="row-chevron" />
      <span
        className="term-handle"
        draggable={false}
        data-drag-ids={JSON.stringify(selected.includes(t.Id) ? activeSelected.map(x => x.Id) : [t.Id])}
        title={
          dragAllowed ? "拖动词条排序" : "筛选、隐藏视图或语法无效时不能拖动"
        }
        onDragStart={(e) => {
          if (!dragAllowed) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(
            "application/prompt-terms",
            JSON.stringify(selected.includes(t.Id) ? selected : [t.Id]),
          );
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
      >
        <DotsSixVertical size={16} />
      </span>
      <span className="term-text mono" title={t.Raw}>
        {t.Base}
      </span>
      <span
        className="term-translation"
        title={app.data.matches[t.Id]?.Translation}
      >
        {app.data.matches[t.Id]?.Translation || "—"}
      </span>
      <span className="term-count mono">
        {app.data.matches[t.Id]?.Count.toLocaleString() || "—"}
      </span>
      <span className="term-weight mono">
        {t.Weight.toFixed(1).replace(/(\.\d*?[1-9])0+$/, "$1")}
      </span>
      <div className="row-actions">
        <IconButton
          icon={hidden ? Eye : EyeSlash}
          label={hidden ? `恢复词条：${t.Base}` : `隐藏词条：${t.Base}`}
          className="row-hide"
          onClick={(e) => {
            e.stopPropagation();
            void safe(hidden ? "editor.restore" : "editor.hide", {
              ids: [t.Id],
            });
          }}
        />
        <IconButton
          icon={DotsThree}
          label={`词条操作：${t.Base}`}
          className="row-menu"
          onClick={(e) => {
            e.stopPropagation();
            termMenu(t, e);
          }}
        />
      </div>
    </div>
  );
  const grouped = () => {
    const view = dragPreview || w;
    const ids = new Set(visible.map((t) => t.Id));
    const byId = new Map(visible.map((t) => [t.Id, t]));
    const result: React.ReactNode[] = [];
    for (const key of [
      ...view.Layout,
      ...(hidden
        ? w.Hidden.filter(
            (t) => !view.Groups.some((g) => g.Members.includes(t.Id)),
          )
            .map((t) => t.Id)
            .filter((id) => !view.Layout.includes(id))
        : []),
    ]) {
      if (key.startsWith("group:")) {
        const g = view.Groups.find((g) => g.Id === key.slice(6));
        if (!g) continue;
        const members = (hidden ? w.Hidden : view.Active).filter(
          (t) => g.Members.includes(t.Id) && ids.has(t.Id),
        );
        if (!members.length && (hidden || query || filter !== "all" || w.Hidden.some((t) => g.Members.includes(t.Id)))) continue;
        const total = g.Members.filter((id) =>
          view.Active.some((t) => t.Id === id),
        ).length;
        const collapsedNow = collapsed.includes(g.Id);
        const isGroupSelected =
          selected.includes(`group:${g.Id}`) ||
          (members.length > 0 && members.every((m) => selected.includes(m.Id)));
        result.push(
          <section
            className={`visual-group cat-${g.Category.toLowerCase()}`}
            key={key}
            data-motion-id={`group:${g.Id}`}
            data-group-id={g.Id}
          >
            <div
              className={`group-row ${isGroupSelected ? "is-selected" : ""}`}
              role="row"
              tabIndex={-1}
              aria-selected={isGroupSelected}
              onMouseDown={(e) => {
                if (e.detail % 2 === 0) clearTimeout(groupClickTimer.current);
                if (!(e.target as HTMLElement).closest("button,.term-handle")) e.preventDefault();
              }}
              onClick={(e) => {
                clearTimeout(groupClickTimer.current);
                const target = e.target as HTMLElement;
                if (target.closest(".group-collapse, .icon-button, .term-handle"))
                  return;
                if (e.detail > 0 && e.detail % 2 === 0) return;
                const modifiers = { ctrlKey: e.ctrlKey, metaKey: e.metaKey };
                if (e.detail === 0) selectGroup(g, modifiers);
                else {
                  const click = { selected, anchor: anchor.current, committed: true };
                  groupClickSelection.current = click;
                  selectGroup(g, modifiers);
                }
              }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("button,.term-handle")) return;
                e.preventDefault();
                clearTimeout(groupClickTimer.current);
                const click = groupClickSelection.current;
                if (click?.committed) {
                  setSelected(click.selected);
                  anchor.current = click.anchor;
                }
                groupClickSelection.current = null;
                void toggleGroup(g);
                e.currentTarget.focus({ preventScroll: true });
              }}
              onContextMenu={(e) => groupMenu(g, e)}
              onDragOver={(e) => {
                if (dragAllowed) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging(false);
                const gid = e.dataTransfer.getData("application/prompt-group");
                const terms = e.dataTransfer.getData("application/prompt-terms");
                const after =
                  e.clientY >
                  e.currentTarget.getBoundingClientRect().top +
                    e.currentTarget.getBoundingClientRect().height / 2;
                if (gid) {
                  void safe("editor.group.move", {
                    id: gid,
                    target: key,
                    after,
                  });
                } else if (terms) {
                  const onGroupName = !!(e.target as HTMLElement)?.closest(
                    ".group-name, .group-count",
                  );
                  void safe("editor.move", {
                    ids: JSON.parse(terms),
                    target: "",
                    group: onGroupName ? g.Id : null,
                    after,
                    block: key,
                  });
                }
              }}
            >
              <button
                className="group-collapse"
                aria-label={`${collapsedNow ? "展开" : "收起"}组：${g.Name || g.Category}`}
                aria-expanded={!collapsedNow}
                onClick={() => void toggleGroup(g)}
              >
                <CaretRight size={18} />
              </button>
              <span
                className="term-handle"
                draggable={false}
                data-drag-group={g.Id}
                title="拖动整个组块"
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/prompt-group", g.Id);
                  setDragging(true);
                }}
                onDragEnd={() => setDragging(false)}
              >
                <DotsSixVertical size={16} />
              </span>
              <span className="group-name" title={g.Name || g.Category}>
                <i />
                <span>{g.Name || g.Category}</span>
              </span>
              <span className="group-category">{g.Category}</span>
              <span className="group-spacer" />
              <span className="group-count">
                {hidden ? members.length : total} 项
              </span>
              <div className="row-actions">
                <IconButton
                  icon={hidden ? Eye : EyeSlash}
                  label={
                    hidden
                      ? `恢复整组：${g.Name || g.Category}`
                      : `隐藏整组：${g.Name || g.Category}`
                  }
                  className="row-hide"
                  onClick={(e) => {
                    e.stopPropagation();
                    const targetIds = (hidden ? w.Hidden : view.Active)
                      .filter((t) => g.Members.includes(t.Id))
                      .map((t) => t.Id);
                    if (targetIds.length > 0) {
                      void safe(hidden ? "editor.restore" : "editor.hide", {
                        ids: targetIds,
                      });
                    }
                  }}
                />
                <IconButton
                  icon={DotsThree}
                  label={`组操作：${g.Name || g.Category}`}
                  className="row-menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    groupMenu(g, e);
                  }}
                />
              </div>
            </div>
            <CollapsibleGroup open={!collapsedNow && members.length > 0}>
              {members.map((t) => row(t, g))}
              {members.length > 0 && g.Description && (
                <div className="group-description">
                  <span>{g.Description}</span>
                </div>
              )}
            </CollapsibleGroup>
          </section>,
          <div
            key={`after-${g.Id}`}
            className="group-after-drop"
            data-after-group={g.Id}
            onDragOver={(e) => {
              if (dragAllowed) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              const gid = e.dataTransfer.getData("application/prompt-group");
              const terms = e.dataTransfer.getData("application/prompt-terms");
              if (gid) {
                void safe("editor.group.move", {
                  id: gid,
                  target: key,
                  after: true,
                });
              } else if (terms) {
                void safe("editor.move", {
                  ids: JSON.parse(terms),
                  target: "",
                  group: null,
                  after: true,
                  block: key,
                });
              }
            }}
          />,
        );
      } else {
        const t = byId.get(key);
        if (t) result.push(row(t));
      }
    }
    return result;
  };
  return (
    <div
      className={`editor-page ${lookup ? "with-lookup" : ""} ${showSource ? "force-source" : ""}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('[data-term-id],.group-row,button,input,textarea,select,a,[role="menu"],[contenteditable="true"]')) {
          setSelected([]); anchor.current = null;
        }
      }}
    >
      <div className="page-heading">
        <h1>{negative ? "消极提示词" : "积极提示词"}</h1>
        <div className="page-actions">
          <IconButton
            icon={FloppyDisk}
            label="保存提示词卡 · Ctrl+S"
            className="motion-press"
            onClick={() =>
              void app.save().catch((e) => {
                if (e.name !== "AbortError") app.reportError(String(e));
              })
            }
          />
          <IconButton
            icon={ArrowUUpLeft}
            label="撤销 · Ctrl+Z"
            disabled={!app.data.canUndo}
            onClick={() => void safe("editor.undo")}
          />
          <IconButton
            icon={ArrowUUpRight}
            label="重做 · Ctrl+Y"
            disabled={!app.data.canRedo}
            onClick={() => void safe("editor.redo")}
          />
          <IconButton
            icon={PushPin}
            label={app.data.settings.Topmost ? "取消窗口置顶" : "窗口置顶"}
            active={app.data.settings.Topmost}
            onClick={async () => {
              const value = !app.data.settings.Topmost;
              if (isTauri()) await getCurrentWindow().setAlwaysOnTop(value);
              await safe("settings.set", {
                value: { ...app.data.settings, Topmost: value },
              });
            }}
          />
          <IconButton
            icon={app.data.settings.Compact ? ArrowsOut : ArrowsIn}
            label={app.data.settings.Compact ? "展开编辑器" : "紧凑模式"}
            active={app.data.settings.Compact}
            onClick={async () => {
              const value = !app.data.settings.Compact;
              await safe("settings.set", {
                value: { ...app.data.settings, Compact: value },
              });
            }}
          />
          <IconButton
            icon={MagnifyingGlass}
            label="打开查词与收藏面板"
            active={lookup}
            onClick={() => setLookup(!lookup)}
          />
          <IconButton
            icon={DotsThree}
            label="更多工作台操作"
            onClick={(e) =>
              setMenu({
                x: e.currentTarget.getBoundingClientRect().right - 230,
                y: 146,
                items: [
                  {
                    label: "新建项目",
                    shortcut: "Ctrl+N",
                    action: app.newProject,
                  },
                  {
                    label: "打开项目…",
                    shortcut: "Ctrl+O",
                    action: app.openProject,
                  },
                  { label: "从图片导入…", action: app.importImage },
                  {
                    label: "另存为提示词卡…",
                    action: () =>
                      app.save(true).catch((e) => {
                        if (e.name !== "AbortError") app.reportError(String(e));
                      }),
                  },
                  { separator: true, label: "" },
                  {
                    label: "收藏全文…",
                    disabled: !w.Active.length,
                    action: () => favoriteForm(true),
                  },
                  {
                    label: "预览复制输出",
                    action: async () =>
                      setPreview(await app.act("editor.copy")),
                  },
                  {
                    label: "全部展开视觉组",
                    action: () => setCollapsedGroups([]),
                  },
                  {
                    label: "全部收起视觉组",
                    action: () => setCollapsedGroups(w.Groups.map((g) => g.Id)),
                  },
                ],
              })
            }
          />
          <IconButton
            icon={Copy}
            label={`复制${negative ? "消极" : "积极"}的全部 ${w.Active.length} 个有效项 · Ctrl+Shift+C`}
            className="primary"
            disabled={!app.data.valid || !w.Active.length}
            onClick={copy}
          />
          <GenerateButton />
        </div>
        <p>
          {w.Active.length} 个有效项　·　{w.Groups.length} 个视觉组　·　
          {w.Hidden.length} 项已隐藏
        </p>
        <span className="page-status">
          {app.data.sessionRestoreError ? "工作区原文件已保护" : "工作区已自动保存"}
          {app.data.dirty && " · 提示词卡有未保存修改"}
        </span>
      </div>
      <div
        className="editor-grid"
        style={
          {
            "--split-columns": split.width
              ? `${split.width}px minmax(0,1fr)`
              : undefined,
            "--source-height": split.height ? `${split.height}px` : undefined,
          } as React.CSSProperties
        }
      >
        <div className="source-column" style={hiddenRatio == null ? undefined : {
          "--source-rows": `minmax(240px, ${hiddenRatio}fr) 12px minmax(100px, ${1 - hiddenRatio}fr)`,
        } as React.CSSProperties}>
          <div
            className="pane-splitter"
            role="separator"
            tabIndex={0}
            aria-label="调整原文与词条区域大小"
            onDoubleClick={() => setSplit({})}
            onPointerDown={(e) => {
              splitDrag.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!splitDrag.current) return;
              const grid = e.currentTarget
                .closest(".editor-grid")!
                .getBoundingClientRect();
              if (
                matchMedia("(max-width:1100px) and (min-height:850px)").matches ||
                (lookup && window.innerWidth <= 1100)
              )
                setSplit((prev) => ({
                  ...prev,
                  height: Math.max(
                    150,
                    Math.min(grid.height - 250, e.clientY - grid.top),
                  ),
                }));
              else
                setSplit((prev) => ({
                  ...prev,
                  width: Math.max(
                    260,
                    Math.min(grid.width - 478, e.clientX - grid.left - 24),
                  ),
                }));
            }}
            onPointerUp={() => (splitDrag.current = false)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                const width =
                  e.currentTarget.parentElement!.getBoundingClientRect().width;
                setSplit((prev) => ({
                  ...prev,
                  width: Math.max(
                    260,
                    width + (e.key === "ArrowLeft" ? -16 : 16),
                  ),
                }));
              }
              if (e.key === "Home") setSplit({});
            }}
          />
          <Panel
            title="原文编辑"
            actions={<span className="hint">可直接输入</span>}
            className="source-panel"
          >
            <div className="source-editor" ref={sourceScroll}>
              <div
                className="line-numbers"
                aria-hidden="true"
                style={{
                  transform: `translateY(-${source.current?.scrollTop || 0}px)`,
                }}
              >
                {sourceLines.map((_, i) => (
                  <span key={i} style={{ height: lineHeights[i] || 30 }}>
                    {i + 1}
                  </span>
                ))}
              </div>
              <div
                className="source-highlights"
                ref={sourceHighlights}
                aria-hidden="true"
                style={{
                  transform: `translateY(-${source.current?.scrollTop || 0}px)`,
                }}
              >
                {sourceLines.map(({ line, at }, i) => {
                  const ranges = activeSelected
                    .map((t) => ({
                      start: Math.max(0, t.Start - at),
                      end: Math.min(line.length, t.Start + t.Length - at),
                    }))
                    .filter((r) => r.end > r.start)
                    .sort((a, b) => a.start - b.start);
                  const parts: React.ReactNode[] = [];
                  let cursor = 0;
                  for (const range of ranges) {
                    const start = Math.max(cursor, range.start);
                    if (range.end <= start) continue;
                    parts.push(line.slice(cursor, start));
                    parts.push(
                      <mark key={start} className="source-selected-token">
                        {line.slice(start, range.end)}
                      </mark>,
                    );
                    cursor = range.end;
                  }
                  parts.push(line.slice(cursor) || (line ? "" : " "));
                  return (
                    <div key={i}>{parts}</div>
                  );
                })}
              </div>
              <textarea
                ref={source}
                aria-label={`${negative ? "消极" : "积极"}提示词原文`}
                value={draft}
                spellCheck={false}
                wrap="soft"
                onPointerDown={() => {
                  sourceSelectionProgrammatic.current = false;
                }}
                onChange={(e) => {
                  sourceSelectionProgrammatic.current = false;
                  const text = e.target.value;
                  draftRef.current = text;
                  setDraft(text);
                  pending.current = true;
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(
                    () => void flush().catch((e) => app.reportError(String(e))),
                    180,
                  );
                  if (!composition.current)
                    void completionSearch(text, e.target.selectionStart);
                }}
                onCompositionStart={() => {
                  composition.current = true;
                  setCompletion(null);
                  void rpc("editor.composition", { active: true });
                }}
                onCompositionEnd={(e) => {
                  composition.current = false;
                  void rpc("editor.composition", { active: false });
                  void completionSearch(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart,
                  );
                }}
                onBlur={() => {
                  setTimeout(() => setCompletion(null), 180);
                  void flush().catch((e) => app.reportError(String(e)));
                  void rpc("editor.view", {
                    caret: source.current?.selectionStart,
                    scroll: source.current?.scrollTop,
                  });
                }}
                onSelect={(e) => {
                  if (completion && (e.currentTarget.selectionStart !== completion.caret || e.currentTarget.selectionEnd !== completion.caret)) setCompletion(null);
                  if (!pending.current && !sourceSelectionProgrammatic.current) {
                    const at = e.currentTarget.selectionStart;
                    const term = w.Active.find(
                      (t) => at >= t.Start && at < t.Start + t.Length,
                    );
                    if (document.activeElement === source.current)
                      setSelected(term ? [term.Id] : []);
                  }
                }}
                onScroll={(e) => {
                  const line =
                    sourceScroll.current?.querySelector<HTMLElement>(
                      ".line-numbers",
                    );
                  if (line)
                    line.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
                  const mirror =
                    sourceScroll.current?.querySelector<HTMLElement>(
                      ".source-highlights",
                    );
                  if (mirror)
                    mirror.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
                }}
                onKeyDown={(e) => {
                  if (!["Control", "Meta", "Shift", "Alt"].includes(e.key))
                    sourceSelectionProgrammatic.current = false;
                  if (e.nativeEvent.isComposing || composition.current) return;
                  if (
                    completion &&
                    ["Tab", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Tab")
                      void chooseCompletion(completion.index);
                    if (e.key === "Escape") setCompletion(null);
                    if (e.key === "ArrowDown")
                      setCompletion({
                        ...completion,
                        index: (completion.index + 1) % completion.items.length,
                      });
                    if (e.key === "ArrowUp")
                      setCompletion({
                        ...completion,
                        index:
                          (completion.index - 1 + completion.items.length) %
                          completion.items.length,
                      });
                  }
                }}
              />
            </div>
            {!app.data.valid && (
              <div className="syntax-error" role="alert">
                {app.data.error} · 结构化操作暂不可用
              </div>
            )}
            <p className="source-help">Tab 补全 · Ctrl + ↑ / ↓ 调整权重</p>
            <div className="output-toolbar">
              <span>复制输出</span>
              <IconButton
                icon={Eye}
                label="预览复制输出"
                disabled={!app.data.valid}
                onClick={async () => {
                  try {
                    setPreview(await app.act("editor.copy"));
                  } catch (e) {
                    app.reportError(String(e));
                  }
                }}
              />
            </div>
            <p className="source-output-hint">自然语言描述随复制输出</p>
          </Panel>
          <div
            className="source-height-splitter"
            role="separator"
            aria-label="调整原文与隐藏文本框高度"
            aria-orientation="horizontal"
            aria-valuemin={20}
            aria-valuemax={80}
            aria-valuenow={Math.round((hiddenRatio ?? 0.8) * 100)}
            tabIndex={0}
            onDoubleClick={() => setHiddenRatio(null)}
            onPointerDown={(e) => {
              e.preventDefault();
              sourceResize.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!sourceResize.current) return;
              const bounds = e.currentTarget.parentElement!.getBoundingClientRect();
              setHiddenRatio(Math.max(0.2, Math.min(0.8, (e.clientY - bounds.top - 6) / (bounds.height - 12))));
            }}
            onPointerUp={() => { sourceResize.current = false; }}
            onPointerCancel={() => { sourceResize.current = false; }}
            onLostPointerCapture={() => { sourceResize.current = false; }}
            onKeyDown={(e) => {
              if (["ArrowUp", "ArrowDown", "Home"].includes(e.key)) {
                e.preventDefault();
                if (e.key === "Home") setHiddenRatio(null);
                else {
                  const column = e.currentTarget.parentElement!;
                  const ratio = column.querySelector(".source-panel")!.getBoundingClientRect().height / (column.clientHeight - 12);
                  setHiddenRatio(Math.max(0.2, Math.min(0.8, ratio + (e.key === "ArrowUp" ? -0.04 : 0.04))));
                }
              }
            }}
          />
          <Panel
            title={`已隐藏 · ${w.Hidden.length}`}
            actions={<span className="hint">只读 · 不参与输出</span>}
            className="hidden-source"
          >
            <pre>{w.Hidden.map(display).join(", ") || "暂无隐藏项"}</pre>
          </Panel>
        </div>
        <div className="terms-column">
          <section className="terms-panel">
            <header className="terms-heading">
              <span>结构化词条</span>
              <Segments
                label="有效或隐藏词条"
                value={hidden ? "hidden" : "active"}
                onChange={(v) => {
                  if ((v === "hidden") !== hidden) captureTermPage();
                  setHidden(v === "hidden");
                  setSelected([]);
                }}
                items={[
                  { label: `有效 ${w.Active.length}`, value: "active" },
                  { label: `隐藏 ${w.Hidden.length}`, value: "hidden" },
                ]}
              />
              <span className="spacer" />
              <IconButton
                icon={Plus}
                label="创建视觉组"
                disabled={!activeSelected.length || !app.data.valid || hidden}
                onClick={() => groupForm()}
              />
              <IconButton
                icon={Star}
                label="收藏选中有效项"
                disabled={!activeSelected.length || hidden || !app.data.valid}
                onClick={() => favoriteForm()}
              />
            </header>
            <div className="term-filter-row">
              <div className="search-input">
                <MagnifyingGlass size={16} />
                <input
                  aria-label="搜索当前条目、原文或译文"
                  placeholder="搜索当前条目、原文或译文"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button aria-label="清空搜索" onClick={() => setQuery("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <Segments
                value={filter}
                onChange={setFilter}
                label="词条类型筛选"
                items={[
                  { value: "all", label: "全部" },
                  { value: "lora", label: "LoRA" },
                  { value: "weighted", label: "带权重" },
                  { value: "unmatched", label: "未匹配" },
                ]}
              />
              <button
                className="duplicates-button"
                disabled={!duplicateKeys.length}
                title="定位下一个重复项；Shift 单击定位上一个"
                onClick={(e) => {
                  const all = duplicateKeys.flat();
                  const at = all.findIndex((t) => selected.includes(t.Id));
                  const t =
                    all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length];
                  if (t) {
                    setSelected([t.Id]);
                    document
                      .querySelector(`[data-term-id="${t.Id}"]`)
                      ?.scrollIntoView({ block: "nearest" });
                  }
                }}
              >
                {duplicateKeys.length
                  ? `${duplicateKeys.length} 组重复项`
                  : "无重复项"}
              </button>
            </div>
            <div
              ref={termListRef}
              className={`term-list ${dragging ? "dragging" : ""}`}
              role="grid"
              aria-label="结构化词条列表"
              tabIndex={0}
              onKeyDown={(e) => {
                if (
                  ["INPUT", "TEXTAREA", "SELECT"].includes(
                    (e.target as HTMLElement).tagName,
                  )
                )
                  return;
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
                  e.preventDefault();
                  setSelected(visible.map((t) => t.Id));
                }
                if (["ArrowDown", "ArrowUp"].includes(e.key) && !e.ctrlKey) {
                  e.preventDefault();
                  let at = visible.findIndex((t) => t.Id === selected.at(-1));
                  at = Math.max(
                    0,
                    Math.min(
                      visible.length - 1,
                      at + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
                  if (visible[at]) select(visible[at].Id, e, false);
                }
                if (e.key === "Delete" && selected.length)
                  void safe("editor.delete", { ids: selected });
              }}
            >
              {visible.length ? (
                grouped()
              ) : (
                <Empty
                  title={
                    hidden
                      ? "暂无隐藏项"
                      : query || filter !== "all"
                        ? "没有匹配的词条"
                        : "从原文开始编辑"
                  }
                  description={
                    hidden
                      ? "隐藏的词条会保留原身份和分组，恢复后重新参与输出。"
                      : query || filter !== "all"
                        ? "尝试其他关键词或清除筛选。"
                        : "在左侧输入提示词，结构化词条会自动显示在这里。"
                  }
                />
              )}
            </div>
          </section>
          <div className="selection-toolbar">
            <strong>已选 {selectedTerms.length} 项</strong>
            <span className="selection-divider" />
            <span className="weight-label">权重</span>
            <IconButton
              icon={Minus}
              label="按当前步长减少选中权重"
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() =>
                void safe("editor.weight", {
                  ids: selected,
                  value: -app.data.settings.Step,
                  relative: true,
                })
              }
            />
            <input
              className="batch-weight mono"
              aria-label="选中项明确权重"
              value={batchWeight}
              disabled={hidden}
              onChange={(e) => setBatchWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  void safe("editor.weight", {
                    ids: selected,
                    value: batchWeight,
                  });
              }}
              onBlur={() => {
                if (
                  selectedTerms.length &&
                  !hidden &&
                  batchWeight.trim() &&
                  Number.isFinite(Number(batchWeight))
                )
                  void safe("editor.weight", {
                    ids: selected,
                    value: batchWeight,
                  });
              }}
            />
            <IconButton
              icon={Plus}
              label="按当前步长增加选中权重"
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() =>
                void safe("editor.weight", {
                  ids: selected,
                  value: app.data.settings.Step,
                  relative: true,
                })
              }
            />
            <span className="spacer" />
            <IconButton
              icon={ArrowCounterClockwise}
              label={hidden ? "恢复选中隐藏项" : "取消所选项权重"}
              disabled={!selectedTerms.length || !app.data.valid}
              onClick={() =>
                void safe(hidden ? "editor.restore" : "editor.weight", {
                  ids: selected,
                  value: null,
                })
              }
            />
            <IconButton
              icon={EyeSlash}
              label="隐藏选中有效项"
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() => void safe("editor.hide", { ids: selected })}
            />
            <IconButton
              icon={ArrowSquareOut}
              label="移出组成为散项"
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() => void safe("editor.detach", { ids: selected })}
            />
            <IconButton
              icon={Crosshair}
              label="定位原文"
              disabled={!activeSelected.length || hidden}
              onClick={locate}
            />
            <IconButton
              icon={Star}
              label="收藏选中片段"
              disabled={!activeSelected.length || hidden || !app.data.valid}
              onClick={() => favoriteForm()}
            />
            <IconButton
              icon={Trash}
              label="删除选中项"
              disabled={!selectedTerms.length || !app.data.valid}
              onClick={() => void safe("editor.delete", { ids: selected })}
            />
            <IconButton
              icon={X}
              label="清除选择"
              disabled={!selected.length}
              onClick={() => setSelected([])}
            />
          </div>
        </div>
        {lookup && (
          <Panel
            title="查词与收藏"
            className="lookup-panel"
            actions={
              <IconButton
                icon={X}
                label="关闭查词面板"
                onClick={() => setLookup(false)}
              />
            }
          >
            <div className="lookup-tabs"><Segments label="查词面板内容" value={lookupTab} onChange={setLookupTab} items={[{value:'lexicon',label:'词库'},{value:'favorites',label:'收藏'}]}/></div>
            <div className="lookup-search">
              <input
                aria-label="中英文查词"
                autoFocus
                placeholder="输入英文或中文查词…"
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
              />
            </div>
            <p className="lookup-result-count">{negative?'消极':'积极'}词库 · {lookupItems.length} 个结果</p>
            <div className="lookup-results" hidden={lookupTab!=='lexicon'}>
              {lookupItems.map((l, i) => (
                <div
                  key={i}
                  className={`lookup-result ${lookupSelected===i?'is-selected':''}`}
                  role="option"
                  aria-selected={lookupSelected===i}
                  onClick={()=>setLookupSelected(i)}
                  onDoubleClick={() =>
                    void safe("editor.insert", {
                      text: l.Text,
                      length:
                        (source.current?.selectionEnd ?? 0) -
                        (source.current?.selectionStart ?? 0),
                    })
                  }
                >
                  <span className="mono">{l.Text}</span>
                  <small>{l.Translation || l.Text}</small>
                  <small>
                    {l.Source}
                    {l.Count ? ` · ${l.Count.toLocaleString()}` : ""}
                  </small>
                  <IconButton
                    icon={Plus}
                    label={`插入 ${l.Text}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void safe("editor.insert", {
                        text: l.Text,
                      });
                    }}
                  />
                </div>
              ))}
              {!lookupItems.length && <Empty title="输入关键词查找词条" />}
            </div>
            <div className="lookup-favorites" hidden={lookupTab!=='favorites'}>
              {app.data.favorites.filter(f=>`${f.Name} ${f.Text}`.toLowerCase().includes(lookupQuery.toLowerCase())).map((f) => (
                <button
                  key={f.Id}
                  onClick={() =>
                    void safe("favorites.insert", { id: f.Id })
                  }
                >
                  <Star size={14} />
                  {f.Name}
                </button>
              ))}
            </div>
            {lookupTab==='lexicon'&&<footer className="lookup-insert"><span>插入到{negative?'消极':'积极'}提示词选中位置，无选中时追加到尾部</span><IconButton icon={ArrowSquareOut} label="插入选中查词结果" className="primary" disabled={!lookupItems[lookupSelected]} onClick={()=>void safe('editor.insert',{text:lookupItems[lookupSelected].Text})}/></footer>}
          </Panel>
        )}
      </div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}{" "}
      {completion && (
        <div
          ref={completionPopup}
          className="completion"
          style={{ left: completion.left, top: completion.top }}
          role="listbox"
          aria-label="光标补全候选"
          onMouseDown={(e) => e.preventDefault()}
        >
          {completion.items.map((l, i) => (
            <div
              role="option"
              aria-selected={i === completion.index}
              key={`${l.Source}-${l.Key}-${i}`}
              className={i === completion.index ? "active" : ""}
              onMouseEnter={() => setCompletion({ ...completion, index: i })}
              onDoubleClick={() => void chooseCompletion(i)}
            >
              <span className="mono">{l.Text}</span>
              <small>{l.Translation}</small>
              <small>
                {l.Source}
                {l.Count ? ` · ${l.Count.toLocaleString()}` : ""}
              </small>
            </div>
          ))}
          <p>Tab 补全 · 双击插入 · Esc 关闭</p>
        </div>
      )}
      {preview !== null && (
        <Modal
          title="复制输出预览"
          width={800}
          onClose={() => setPreview(null)}
          footer={
            <>
              <span className="hint">输出全部有效项，隐藏项不参与输出</span>
              <span className="spacer" />
              <button onClick={() => setPreview(null)}>关闭</button>
              <button
                className="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(preview);
                  app.notify("已复制完整输出");
                }}
              >
                <Copy size={16} />
                复制全部
              </button>
            </>
          }
        >
          <pre className="output-preview large">
            {preview || "暂无有效输出"}
          </pre>
        </Modal>
      )}
    </div>
  );
}
