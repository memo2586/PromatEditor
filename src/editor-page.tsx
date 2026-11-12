import { tr, trDiagnostic } from "./i18n";
import { CollapsibleGroup, useTermPageMotion } from "./editor-motion";
import { usePointerSort } from "./pointer-sort";
import type { Workspace } from "./types";
import { useListMotion } from "./motion";
import { openProbe } from "./comfy-probe";
import { usePromptCompletion } from "./prompt-completion";
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
        description: group?.Description,
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
      title={group ? tr("修改视觉组") : tr("创建视觉组")}
      onClose={onClose}
      width={680}
      footer={
        <>
          <span className="hint">{terms.length}{" " + tr("个有效成员")}</span>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button className="primary" onClick={save}>
            {group ? tr("保存修改") : tr("创建视觉组")}
          </button>
        </>
      }
    >
      <div className="group-form-fields">
        <Field label={tr("组名（可选）")}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr("为这组词条起一个名字")}
          />
        </Field>
        <Field label={tr("类别")}>
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
        <Field label={tr("输出预览 · 实时更新")}>
          <pre className="output-preview">
            {body || tr("请选择要归组的有效词条")}
          </pre>
        </Field>
        <Notice>{tr("组名和类别用于整理。修改组时保留成员与权重。")}</Notice>
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
      title={favorite ? tr("编辑收藏片段") : tr("收藏选中片段")}
      width={680}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
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
          >{tr("保存收藏")}</button>
        </>
      }
    >
      <Field label={tr("收藏名称")}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={tr("类别")}>
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
      <Field label={tr("提示词原文")}>
        <textarea
          rows={7}
          readOnly={!!ids?.length}
          className="mono"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </Field>
      <p className="hint">{tr("收藏片段与插入后的视觉组分别保存，互不影响。")}</p>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function TermForm({ term, onClose }: { term: Term; onClose: () => void }) {
  const app = useApp();
  const natural = term.Kind === "natural";
  const [text, setText] = useState(term.Base);
  const [weight, setWeight] = useState(String(term.Weight));
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const completionCaret = useRef<number | null>(null);
  const completion = usePromptCompletion(input, (value, start, end) => {
    const next = text.slice(0, start) + value + text.slice(end);
    const caret = start + value.length;
    if (next === text) input.current?.setSelectionRange(caret, caret);
    else {
      completionCaret.current = caret;
      setText(next);
    }
  }, true);
  useLayoutEffect(() => {
    if (completionCaret.current !== null && input.current) {
      input.current.setSelectionRange(completionCaret.current, completionCaret.current);
      completionCaret.current = null;
    }
  }, [text]);
  return (
    <Modal
      title={natural ? tr("编辑自然语言提示词") : tr("编辑词条")}
      onClose={onClose}
      width={640}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button
            ref={saveButton}
            className="primary"
            disabled={natural ? !text.trim() : !term.Editable}
            onClick={async () => {
              try {
                if (natural) {
                  await app.act("editor.natural.edit", { id: term.Id, text });
                  onClose();
                  return;
                }
                const n = Number(weight);
                if (!weight.trim() || !Number.isFinite(n))
                  throw Error(tr("权重必须是有限十进制数"));
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
          >{tr("保存词条")}</button>
        </>
      }
    >
      <Field label={tr("原文")}>
        <textarea
          ref={input}
          data-default-focus
          data-completion-open={completion.open}
          rows={4}
          value={text}
          readOnly={!natural && (!term.Editable || term.Kind === "lora")}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (!natural && !composing.current) void completion.search(e.currentTarget);
          }}
          onCompositionStart={() => {
            composing.current = true;
            completion.close();
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            if (!natural) void completion.search(e.currentTarget);
          }}
          onSelect={(e) => completion.onSelect(e.currentTarget)}
          onBlur={completion.close}
          onKeyDown={(e) => {
            if (natural && e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!e.repeat) saveButton.current?.click();
            } else completion.onKeyDown(e);
          }}
          className="mono"
        />
        {completion.popup}
      </Field>
      {!natural && <Field label={tr("权重")}>
        <input
          type="number"
          step="0.1"
          value={weight}
          readOnly={!term.Editable}
          onChange={(e) => setWeight(e.target.value)}
        />
      </Field>}
      {!natural && !term.Editable && (
        <Notice>{tr("复杂或语义不明确的语法仅支持在原文区域编辑。")}</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function InlineTermEditor({ initial, save, cancel }: {
  initial: string;
  save: (text: string) => Promise<void>;
  cancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const saving = useRef(false);
  const caret = useRef<number | null>(null);
  const completion = usePromptCompletion(input, (value, start, end) => {
    const next = text.slice(0, start) + value + text.slice(end);
    if (next === text) input.current?.setSelectionRange(start + value.length, start + value.length);
    else {
      caret.current = start + value.length;
      setText(next);
    }
  });
  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(0, field.value.length, "forward");
  }, []);
  useLayoutEffect(() => {
    if (caret.current !== null) {
      input.current?.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [text]);
  return <>
    <textarea
      ref={input} rows={1} wrap="off" className="inline-term-input" aria-label={tr("词条原文")}
      value={text} spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setText(e.currentTarget.value);
        if (!composing.current) void completion.search(e.currentTarget);
      }}
      onCompositionStart={() => { composing.current = true; completion.close(); }}
      onCompositionEnd={(e) => { composing.current = false; void completion.search(e.currentTarget); }}
      onSelect={(e) => completion.onSelect(e.currentTarget)}
      onBlur={() => {
        completion.close();
        cancel();
        if (!saving.current && text.trim() && text !== initial) void save(text);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (composing.current || e.nativeEvent.isComposing) return;
        completion.onKeyDown(e);
        if (e.defaultPrevented || saving.current) return;
        if (e.key === "Escape") cancel();
        if (e.key === "Enter") {
          e.preventDefault();
          saving.current = true;
          completion.close();
          void save(text).finally(() => { saving.current = false; });
        }
      }}
    />
    {completion.popup}
  </>;
}

export function EditorPage() {
  const app = useApp();
  const state = app.data.project.State;
  const negative = state.IsNegative;
  const w = negative ? state.Negative : state.Positive;
  const [draft, setDraft] = useState(w.Text);
  const draftRef = useRef(w.Text);
  const pending = useRef(false);
  const savingText = useRef<Promise<unknown> | null>(null);
  type Selection = [number, number];
  const beforeInput = useRef<Selection | null>(null);
  const draftView = useRef<{ before: Selection; after: Selection; scroll: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = source.current;
    if (!input) return;
    const capture = () => { beforeInput.current = [input.selectionStart, input.selectionEnd]; };
    input.addEventListener("beforeinput", capture);
    return () => input.removeEventListener("beforeinput", capture);
  }, []);
  // List navigation mirrors a range into the source without replacing batch selection.
  const sourceSelectionProgrammatic = useRef(false);
  const sourceFollowsList = useRef(false);
  const sourceSelection = useRef<{
    text: string; start: number; end: number; negative: boolean; scrollTop: number; scrollLeft: number;
  } | null>(null);
  const applySourceSelection = () => {
    const selection = sourceSelection.current;
    const input = source.current;
    if (selection && selection.negative !== negative) sourceSelection.current = null;
    if (!selection || !input || selection.negative !== negative || selection.text !== input.value) return;
    sourceSelection.current = null;
    sourceSelectionProgrammatic.current = true;
    input.focus({ preventScroll: true });
    input.setSelectionRange(selection.start, selection.end);
    input.scrollTop = selection.scrollTop;
    input.scrollLeft = selection.scrollLeft;
  };
  useLayoutEffect(applySourceSelection);
  const restoreSourceSelection = (next: Workspace, start = next.Caret, end = next.SelectionEnd ?? start, scrollTop = next.Scroll) => {
    sourceSelection.current = {
      text: next.Text, start, end, negative, scrollTop, scrollLeft: source.current?.scrollLeft ?? 0,
    };
    applySourceSelection();
  };
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
  const naturalLines = useMemo(() => {
    const ranges = w.Natural || [];
    if (!ranges.length) return new Map<number, number>();
    let prefix = 0;
    while (prefix < Math.min(draft.length, w.Text.length) && draft[prefix] === w.Text[prefix]) prefix++;
    let suffix = 0;
    while (suffix < Math.min(draft.length, w.Text.length) - prefix &&
           draft[draft.length - 1 - suffix] === w.Text[w.Text.length - 1 - suffix]) suffix++;
    return new Map(ranges.flatMap(({ Start, Length }) => {
      const at = Start >= w.Text.length - suffix ? Start + draft.length - w.Text.length : Math.min(Start, prefix);
      if (Start + Length <= prefix) return [[draft.lastIndexOf("\n", Start - 1) + 1, Start]];
      if (at < 0 || at >= draft.length) return [];
      const lineStart = at === 0 ? 0 : draft.lastIndexOf("\n", at - 1) + 1;
      const line = draft.slice(lineStart).split("\n", 1)[0];
      return line.trim() ? [[lineStart, lineStart + line.length - line.trimStart().length]] : [];
    }));
  }, [draft, w.Text, w.Natural]);
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
  const [inlineEdit, setInlineEdit] = useState<{ term: string } | { group: string } | null>(null);
  useEffect(() => setInlineEdit(null), [negative, hidden, app.page]);
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
  const composition = useRef(false);
  const completion = usePromptCompletion(source, async (text, start, end) => {
    const input = source.current;
    if (!input || composition.current) return;
    const scroll = input.scrollTop;
    const result = await safe("editor.insert", {
      text, start, length: end - start, completion: true,
    });
    if (result) restoreSourceSelection(result.project.State[negative ? "Negative" : "Positive"],
      start + text.length, start + text.length, scroll);
  });
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
    width?: number;
    className?: string;
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
    while (savingText.current || pending.current) {
      if (savingText.current) {
        await savingText.current;
        continue;
      }
      pending.current = false;
      const view = draftView.current;
      draftView.current = null;
      const text = draftRef.current;
      const saving = app.act<{ error: string | null }>("editor.text", { text, ...view });
      savingText.current = saving;
      try {
        const result = await saving;
        if (result.error && draftRef.current === text) completion.close();
      } finally {
        savingText.current = null;
      }
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
      completion.close();
      sourceFollowsList.current = false;
      requestAnimationFrame(() => {
        if (source.current) {
          sourceSelectionProgrammatic.current = true;
          source.current.setSelectionRange(w.Caret, w.SelectionEnd ?? w.Caret);
          source.current.scrollTop = w.Scroll;
        }
      });
    } else if (!pending.current && !savingText.current && draftRef.current !== w.Text) {
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
  const currentWorkspace = (result: { project: typeof app.data.project }) =>
    result.project.State[negative ? "Negative" : "Positive"];
  const history = async (method: "editor.undo" | "editor.redo", fromSource: boolean) => {
    completion.close();
    const result = await safe(method);
    if (result && fromSource) restoreSourceSelection(currentWorkspace(result));
  };
  const mirrorSourceCaret = (term: Term) => {
    const textarea = source.current;
    if (!textarea) return;
    const { scrollTop, scrollLeft } = textarea;
    sourceFollowsList.current = true;
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
  const hasNaturalSelection = activeSelected.some((t) => t.Kind === "natural");
  const selectedIds = selectedTerms.map((t) => t.Id);
  const weightIds = activeSelected.filter((t) => t.Kind !== "natural").map((t) => t.Id);
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
        tr("已复制{0}提示词的全部 {1} 个有效项", negative ? tr("消极") : tr("积极"), w.Active.length),
      );
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const locateTerm = (t = activeSelected[0]) => {
    if (!t || !source.current) return;
    setShowSource(true);
    requestAnimationFrame(() => {
      sourceFollowsList.current = false;
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
  const bindNatural = async (start: number, end: number, fromSource = false, ids?: string[]) => {
    completion.close();
    const result = await safe("editor.natural.bind", { start, end, ids });
    if (result && fromSource) restoreSourceSelection(currentWorkspace(result));
  };
  const unbindNatural = (start: number) => safe("editor.natural.unbind", { start });
  const sourceMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    const input = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = input;
    const lines = [...(sourceHighlights.current?.children || [])];
    const line = lines.findIndex((el) => {
      const rect = el.getBoundingClientRect();
      return e.clientY >= rect.top && e.clientY < rect.bottom;
    });
    const lineStart = line >= 0 ? sourceLines[line].at
      : (e.clientX === 0 && e.clientY === 0 ? draft.slice(0, start).lastIndexOf("\n") + 1 : -1);
    const at = naturalLines.get(lineStart);
    if (at === undefined && !draft.slice(start, end).trim()) return;
    e.preventDefault();
    completion.close();
    setMenu({
      x: e.clientX, y: e.clientY, width: 220, className: "source-action-menu",
      items: at === undefined
        ? [{ label: tr("创建自然语言提示词"), action: () => bindNatural(start, end, true) }]
        : [{ label: tr("取消自然语言绑定"), action: () => unbindNatural(at) }],
    });
  };
  const symbolMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const clean = async (action: "commas" | "escape") => {
      const result = await safe("editor.symbols.clean", { action });
      if (result) app.notify(result.changes ? tr("已整理 {0} 处符号 · Ctrl + Z 撤销", result.changes) : tr("没有需要整理的符号"));
    };
    setMenu({
      x: bounds.right - 220, y: bounds.bottom + 4, width: 220, className: "source-action-menu",
      items: [
        { label: tr("清理重复逗号"), action: () => clean("commas") },
        { label: tr("转义未配对的符号"), action: () => clean("escape") },
      ],
    });
  };
  const structuredTextRange = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const offset = (container: Node, at: number) => {
      const span = (container instanceof Element ? container : container.parentElement)?.closest(".term-content");
      if (!span || !termListRef.current?.contains(span)) return null;
      const term = w.Active.find((t) => t.Id === span.closest<HTMLElement>(".term-row")?.dataset.termId);
      if (!term || draft.slice(term.BaseStart, term.BaseStart + term.BaseLength) !== term.Base) return null;
      const before = document.createRange();
      before.selectNodeContents(span);
      before.setEnd(container, at);
      return term.BaseStart + before.toString().length;
    };
    const start = offset(range.startContainer, range.startOffset);
    const end = offset(range.endContainer, range.endOffset);
    return start !== null && end !== null && start < end ? { start, end } : null;
  };
  const structuredTermRange = (ids: string[]) => {
    const terms = w.Active.filter((t) => ids.includes(t.Id));
    if (!terms.length || terms.some((t) => t.Kind === "natural")) return null;
    const first = w.Active.indexOf(terms[0]);
    const last = terms[terms.length - 1];
    if (w.Active[first + terms.length - 1] !== last) return null;
    return { start: terms[0].Start, end: last.Start + last.Length };
  };
  const editTerm = (term: Term) => {
    if (term.Kind === "normal" && term.Editable && app.data.valid) {
      setInlineEdit({ term: term.Id });
    } else {
      app.modal(<TermForm term={term} onClose={() => app.modal(null)} />);
    }
  };
  const beginGroupTerm = (g: Group) => setInlineEdit({ group: g.Id });
  const addToSelectedGroup = () => {
    if (hidden || !app.data.valid || menu) return false;
    const groups = w.Groups.filter((g) => selected.includes(`group:${g.Id}`));
    if (groups.length !== 1 || !w.Active.some((t) => groups[0].Members.includes(t.Id))) return false;
    beginGroupTerm(groups[0]);
    return true;
  };
  const termMenu = (t: Term, e: MouseEvent) => {
    e.preventDefault();
    const textRange = structuredTextRange();
    if (!selected.includes(t.Id)) setSelected([t.Id]);
    const target = selected.includes(t.Id) ? selectedTerms.map((t) => t.Id) : [t.Id];
    if (t.Kind === "natural") {
      setMenu({
        x: e.clientX, y: e.clientY, width: 220, className: "source-action-menu",
        items: [
          ...(!hidden ? [{ label: tr("取消自然语言绑定"), action: () => unbindNatural(t.Start) }] : []),
          { label: hidden ? tr("恢复所选项") : tr("隐藏所选项"), action: () =>
            safe(hidden ? "editor.restore" : "editor.hide", { ids: target }) },
          { label: tr("删除所选项"), danger: true, action: () => safe("editor.delete", { ids: target }) },
        ],
      });
      return;
    }
    const termRange = structuredTermRange(target);
    const range = textRange || termRange;
    const wholeTerms = !textRange || (termRange && textRange.start === termRange.start && textRange.end === termRange.end);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(!hidden ? [{ label: tr("创建自然语言提示词"), disabled: !range, action: () => {
          if (range) void bindNatural(range.start, range.end, false, wholeTerms ? target : undefined);
        } }] : []),
        {
          label: tr("试试该词条的效果…"),
          disabled: hidden,
          action: () => openProbe(t.Id,"weight",app.data.project.State.IsNegative),
        },
        {
          label: tr("编辑词条…"),
          action: () => editTerm(t),
        },
        {
          label: tr("定位原文"),
          disabled: hidden,
          action: () => {
            setSelected([t.Id]);
            locateTerm(t);
          },
        },
        {
          label: hidden ? tr("恢复所选项") : tr("隐藏所选项"),
          action: () =>
            safe(hidden ? "editor.restore" : "editor.hide", { ids: target }),
        },
        {
          label: tr("取消权重"),
          disabled: hidden || !t.Editable,
          action: () => safe("editor.weight", { ids: target.filter((id) => weightIds.includes(id) || id === t.Id), value: null }),
        },
        {
          label: tr("创建视觉组…"),
          disabled: hidden || w.Active.some((term) => term.Kind === "natural" && target.includes(term.Id)),
          action: () => groupForm(undefined, target),
        },
        {
          label: tr("移出视觉组"),
          disabled: hidden,
          action: () => safe("editor.detach", { ids: target }),
        },
        { separator: true, label: "" },
        {
          label: tr("删除所选项"),
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
    const range = structuredTermRange(active);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tr("添加提示词"), shortcut: "I", disabled: hidden || !app.data.valid || !active.length,
          action: () => beginGroupTerm(g) },
        {
          label: collapsed.includes(g.Id) ? tr("展开组") : tr("收起组"),
          action: () => toggleGroup(g),
        },
        {
          label: tr("选择整组有效项"),
          disabled: !active.length,
          action: () => setSelected([...active, `group:${g.Id}`]),
        },
        { label: tr("修改组名 / 类别…"), action: () => groupForm(g) },
        ...(!hidden ? [{
          label: tr("创建自然语言提示词"), disabled: !range,
          action: () => { if (range) void bindNatural(range.start, range.end, false, active); },
        }] : []),
        {
          label: tr("隐藏整组有效项"),
          disabled: !active.length,
          action: () => safe("editor.hide", { ids: active }),
        },
        {
          label: tr("恢复隐藏成员"),
          disabled: !inactive.length,
          action: () => safe("editor.restore", { ids: inactive }),
        },
        { separator: true, label: "" },
        {
          label: tr("解散组（保留词条）"),
          action: () => safe("editor.group.dissolve", { id: g.Id }),
        },
        {
          label: tr("删除整组（含隐藏成员）"),
          danger: true,
          action: async () => {
            if (
              (await app.confirm({
                title: tr("删除整个视觉组？"),
                body: (
                  <p>
                    “{g.Name || g.Category}{tr("”的") + " "}{g.Members.length}{" "}{tr("个成员（含隐藏项）将被删除，可通过撤销恢复。")}</p>
                ),
                confirm: tr("删除整组"),
                danger: true,
              })) === "confirm"
            )
              await safe("editor.group.delete", { id: g.Id });
          },
        },
      ],
    });
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
      const raw = source.current;
      const fromSource = e.target === raw;
      const isText = ["TEXTAREA", "INPUT"].includes(
        (e.target as HTMLElement).tagName,
      );
      if (!mod && !e.altKey && !e.shiftKey && e.key === "i" && !isText &&
          !(e.target as HTMLElement).isContentEditable && (e.target as HTMLElement).tagName !== "SELECT" &&
          addToSelectedGroup()) {
        e.preventDefault();
        return;
      }
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
        void history("editor.undo", fromSource);
      }
      if (
        mod &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        void history("editor.redo", fromSource);
      }
      if (mod && ["ArrowUp", "ArrowDown"].includes(e.key)) {
        if (isText && !fromSource) return;
        let target = activeSelected;
        if (raw && fromSource && !sourceFollowsList.current) {
          const { selectionStart, selectionEnd } = raw;
          target = w.Active.filter((t) => selectionStart === selectionEnd
            ? selectionStart >= t.Start && selectionStart <= t.Start + t.Length
            : selectionStart < t.Start + t.Length && selectionEnd > t.Start);
        }
        const ids = target.filter((t) => t.Kind !== "natural").map((t) => t.Id);
        if (!ids.length) return;
        e.preventDefault();
        completion.close();
        const scroll = raw?.scrollTop;
        void safe("editor.weight", {
          ids,
          value: app.data.settings.Step * (e.key === "ArrowUp" ? 1 : -1),
          relative: true,
        }).then((result) => {
          if (!result || !fromSource || document.activeElement !== raw) return;
          const next = currentWorkspace(result);
          const t = next.Active.find((term) => term.Id === ids[0]);
          if (t) restoreSourceSelection(next, t.Start, t.Start, scroll);
        });
      }
      if (e.key === "Escape") {
        completion.close();
        setDragging(false);
        cancelPointerDrag();
        setMenu(null);
        if (!isText) setSelected([]);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selected, w, app.page, app.data.settings, app.data.valid, hidden, menu]);
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
      className={`term-row ${group ? "member" : ""} ${selected.includes(t.Id) ? "is-selected" : ""} ${!t.Editable ? "readonly" : ""} ${t.Kind === "natural" ? "natural-term" : ""}`}
      data-motion-id={`term:${t.Id}`}
      data-term-id={t.Id}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("button,input,textarea,.term-handle") &&
            (e.button !== 0 || !(e.target as HTMLElement).closest(".term-content") || e.ctrlKey || e.metaKey || e.shiftKey)) e.preventDefault();
      }}
      onClick={(e) => {
        if (hidden) e.currentTarget.focus({ preventScroll: true });
        if (!structuredTextRange()) select(t.Id, e);
      }}
      onDoubleClick={() => editTerm(t)}
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
          dragAllowed ? tr("拖动词条排序") : tr("筛选、隐藏视图或语法无效时不能拖动")
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
        {t.Kind === "natural" && <span className="natural-term-label">{tr("自然语言")}</span>}
        {inlineEdit && "term" in inlineEdit && inlineEdit.term === t.Id
          ? <InlineTermEditor initial={t.Base} cancel={() => setInlineEdit(null)} save={async (text) => {
              if (await safe("editor.term.edit", { id: t.Id, text }))
                setInlineEdit((edit) => edit && "term" in edit && edit.term === t.Id ? null : edit);
            }} />
          : <span className="term-content">{t.Base}</span>}
      </span>
      {t.Kind !== "natural" && <><span
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
      </span></>}
      <div className="row-actions">
        <IconButton
          icon={hidden ? Eye : EyeSlash}
          label={hidden ? tr("恢复词条：{0}", t.Base) : tr("隐藏词条：{0}", t.Base)}
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
          label={tr("词条操作：{0}", t.Base)}
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
        const adding = inlineEdit && "group" in inlineEdit && inlineEdit.group === g.Id;
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
                aria-label={tr("{0}组：{1}", collapsedNow ? tr("展开") : tr("收起"), g.Name || g.Category)}
                aria-expanded={!collapsedNow}
                onClick={() => void toggleGroup(g)}
              >
                <CaretRight size={18} />
              </button>
              <span
                className="term-handle"
                draggable={false}
                data-drag-group={g.Id}
                title={tr("拖动整个组块")}
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
                {hidden ? members.length : total}{" " + tr("项")}</span>
              <div className="row-actions">
                <IconButton
                  icon={hidden ? Eye : EyeSlash}
                  label={
                    hidden
                      ? tr("恢复整组：{0}", g.Name || g.Category)
                      : tr("隐藏整组：{0}", g.Name || g.Category)
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
                  label={tr("组操作：{0}", g.Name || g.Category)}
                  className="row-menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    groupMenu(g, e);
                  }}
                />
              </div>
            </div>
            <CollapsibleGroup open={!!adding || (!collapsedNow && members.length > 0)}>
              {members.map((t) => row(t, g))}
              {adding && <div className="term-row member" role="row">
                <div className="term-text">
                  <InlineTermEditor initial="" cancel={() => setInlineEdit(null)} save={async (text) => {
                    if (!text.trim()) { setInlineEdit(null); return; }
                    if (await safe("editor.group.append", { id: g.Id, text })) {
                      if (collapsedRef.current.includes(g.Id)) await toggleGroup(g);
                      setInlineEdit((edit) => edit && "group" in edit && edit.group === g.Id ? null : edit);
                    }
                  }} />
                </div>
              </div>}
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
        <h1>{negative ? tr("消极提示词") : tr("积极提示词")}</h1>
        <div className="page-actions">
          <IconButton
            icon={FloppyDisk}
            label={tr("保存提示词卡 · Ctrl+S")}
            className="motion-press"
            onClick={() =>
              void app.save().catch((e) => {
                if (e.name !== "AbortError") app.reportError(String(e));
              })
            }
          />
          <IconButton
            icon={ArrowUUpLeft}
            label={tr("撤销 · Ctrl+Z")}
            disabled={!app.data.canUndo}
            onClick={() => void safe("editor.undo")}
          />
          <IconButton
            icon={ArrowUUpRight}
            label={tr("重做 · Ctrl+Y")}
            disabled={!app.data.canRedo}
            onClick={() => void safe("editor.redo")}
          />
          <IconButton
            icon={PushPin}
            label={app.data.settings.Topmost ? tr("取消窗口置顶") : tr("窗口置顶")}
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
            label={app.data.settings.Compact ? tr("展开编辑器") : tr("紧凑模式")}
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
            label={tr("打开查词与收藏面板")}
            active={lookup}
            onClick={() => setLookup(!lookup)}
          />
          <IconButton
            icon={DotsThree}
            label={tr("更多工作台操作")}
            onClick={(e) =>
              setMenu({
                x: e.currentTarget.getBoundingClientRect().right - 230,
                y: 146,
                items: [
                  {
                    label: tr("新建项目"),
                    shortcut: "Ctrl+N",
                    action: app.newProject,
                  },
                  {
                    label: tr("打开项目…"),
                    shortcut: "Ctrl+O",
                    action: app.openProject,
                  },
                  { label: tr("从图片导入…"), action: app.importImage },
                  {
                    label: tr("另存为提示词卡…"),
                    action: () =>
                      app.save(true).catch((e) => {
                        if (e.name !== "AbortError") app.reportError(String(e));
                      }),
                  },
                  { separator: true, label: "" },
                  {
                    label: tr("收藏全文…"),
                    disabled: !w.Active.length,
                    action: () => favoriteForm(true),
                  },
                  {
                    label: tr("预览复制输出"),
                    action: async () =>
                      setPreview(await app.act("editor.copy")),
                  },
                  {
                    label: tr("全部展开视觉组"),
                    action: () => setCollapsedGroups([]),
                  },
                  {
                    label: tr("全部收起视觉组"),
                    action: () => setCollapsedGroups(w.Groups.map((g) => g.Id)),
                  },
                ],
              })
            }
          />
          <IconButton
            icon={Copy}
            label={tr("复制{0}的全部 {1} 个有效项 · Ctrl+Shift+C", negative ? tr("消极") : tr("积极"), w.Active.length)}
            className="primary"
            disabled={!app.data.valid || !w.Active.length}
            onClick={copy}
          />
          <GenerateButton />
        </div>
        <p>
          {w.Active.length}{" " + tr("个有效项　·")}{w.Groups.length}{" " + tr("个视觉组　·")}{w.Hidden.length}{" " + tr("项已隐藏")}</p>
        <span className="page-status">
          {app.data.sessionRestoreError ? tr("工作区原文件已保护") : tr("工作区已自动保存")}
          {app.data.dirty && tr(" · 提示词卡有未保存修改")}
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
            aria-label={tr("调整原文与词条区域大小")}
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
            title={tr("原文编辑")}
            actions={<button type="button" className="source-symbols" aria-haspopup="menu" onClick={symbolMenu}>{tr("符号整理") + " "}<CaretDown size={12} /></button>}
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
                    <div key={i} className={naturalLines.has(at) ? "source-natural-line" : undefined}>{parts}</div>
                  );
                })}
              </div>
              <textarea
                ref={source}
                aria-label={tr("{0}提示词原文", negative ? tr("消极") : tr("积极"))}
                value={draft}
                spellCheck={false}
                wrap="soft"
                onContextMenu={sourceMenu}
                onPointerDown={() => {
                  sourceSelectionProgrammatic.current = false;
                  sourceFollowsList.current = false;
                }}
                onChange={(e) => {
                  sourceSelectionProgrammatic.current = false;
                  sourceFollowsList.current = false;
                  const input = e.currentTarget;
                  const text = input.value;
                  const after: Selection = [input.selectionStart, input.selectionEnd];
                  draftView.current = {
                    before: draftView.current?.before ?? beforeInput.current ?? [w.Caret, w.SelectionEnd ?? w.Caret],
                    after, scroll: input.scrollTop,
                  };
                  beforeInput.current = null;
                  draftRef.current = text;
                  setDraft(text);
                  pending.current = true;
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(
                    () => void flush().catch((e) => app.reportError(String(e))),
                    180,
                  );
                  if (!composition.current && !naturalLines.has(text.slice(0, input.selectionStart).lastIndexOf("\n") + 1))
                    void completion.search(input);
                  else completion.close();
                }}
                onCompositionStart={() => {
                  composition.current = true;
                  completion.close();
                  void rpc("editor.composition", { active: true });
                }}
                onCompositionEnd={(e) => {
                  composition.current = false;
                  void rpc("editor.composition", { active: false });
                  const input = e.currentTarget;
                  if (!naturalLines.has(input.value.slice(0, input.selectionStart).lastIndexOf("\n") + 1))
                    void completion.search(input);
                }}
                onBlur={(e) => {
                  completion.close();
                  const { selectionStart: caret, selectionEnd, scrollTop: scroll } = e.currentTarget;
                  void flush().catch((e) => app.reportError(String(e)));
                  void rpc("editor.view", { caret, selectionEnd, scroll });
                }}
                onSelect={(e) => {
                  completion.onSelect(e.currentTarget);
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
                  if (sourceFollowsList.current && e.key === "i" && !e.ctrlKey && !e.metaKey &&
                      !e.altKey && !e.shiftKey && !e.nativeEvent.isComposing && !composition.current &&
                      addToSelectedGroup()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  const movesCaret = e.ctrlKey || e.metaKey
                    ? ["ArrowLeft", "ArrowRight", "Home", "End", "a"].includes(e.key)
                    : !["Control", "Meta", "Shift", "Alt"].includes(e.key);
                  if (movesCaret) {
                    sourceSelectionProgrammatic.current = false;
                    sourceFollowsList.current = false;
                  }
                  if (e.nativeEvent.isComposing || composition.current) return;
                  completion.onKeyDown(e);
                }}
              />
            </div>
            {!app.data.valid && (
              <div className="syntax-error" role="alert">
                {trDiagnostic(app.data.error || "")}{" " + tr("· 结构化操作暂不可用")}</div>
            )}
            <p className="source-help">{tr("Tab 补全 · Ctrl + ↑ / ↓ 调整权重")}</p>
            <div className="output-toolbar">
              <span>{tr("复制输出")}</span>
              <IconButton
                icon={Eye}
                label={tr("预览复制输出")}
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
          </Panel>
          <div
            className="source-height-splitter"
            role="separator"
            aria-label={tr("调整原文与隐藏文本框高度")}
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
            title={tr("已隐藏 · {0}", w.Hidden.length)}
            actions={<span className="hint">{tr("只读 · 不参与输出")}</span>}
            className="hidden-source"
          >
            <pre>{w.Hidden.map(display).join(", ") || tr("暂无隐藏项")}</pre>
          </Panel>
        </div>
        <div className="terms-column">
          <section className="terms-panel">
            <header className="terms-heading">
              <span>{tr("结构化词条")}</span>
              <Segments
                label={tr("有效或隐藏词条")}
                value={hidden ? "hidden" : "active"}
                onChange={(v) => {
                  if ((v === "hidden") !== hidden) captureTermPage();
                  setHidden(v === "hidden");
                  setSelected([]);
                }}
                items={[
                  { label: tr("有效 {0}", w.Active.length), value: "active" },
                  { label: tr("隐藏 {0}", w.Hidden.length), value: "hidden" },
                ]}
              />
              <span className="spacer" />
              <IconButton
                icon={Plus}
                label={tr("创建视觉组")}
                disabled={!activeSelected.length || hasNaturalSelection || !app.data.valid || hidden}
                onClick={() => groupForm()}
              />
              <IconButton
                icon={Star}
                label={tr("收藏选中有效项")}
                disabled={!activeSelected.length || hidden || !app.data.valid}
                onClick={() => favoriteForm()}
              />
            </header>
            <div className="term-filter-row">
              <div className="search-input">
                <MagnifyingGlass size={16} />
                <input
                  aria-label={tr("搜索当前条目、原文或译文")}
                  data-workspace-search
                  placeholder={tr("搜索当前条目、原文或译文")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button aria-label={tr("清空搜索")} onClick={() => setQuery("")}>
                    <X size={12} />
                  </button>
                )}
              </div>
              <Segments
                value={filter}
                onChange={setFilter}
                label={tr("词条类型筛选")}
                items={[
                  { value: "all", label: tr("全部") },
                  { value: "lora", label: "LoRA" },
                  { value: "weighted", label: tr("带权重") },
                  { value: "unmatched", label: tr("未匹配") },
                ]}
              />
              <button
                className="duplicates-button"
                disabled={!duplicateKeys.length}
                title={tr("定位下一个重复项；Shift 单击定位上一个")}
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
                  ? tr("{0} 组重复项", duplicateKeys.length)
                  : tr("无重复项")}
              </button>
            </div>
            <div
              ref={termListRef}
              className={`term-list ${dragging ? "dragging" : ""}`}
              role="grid"
              aria-label={tr("结构化词条列表")}
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
                      ? tr("暂无隐藏项")
                      : query || filter !== "all"
                        ? tr("没有匹配的词条")
                        : tr("从原文开始编辑")
                  }
                  description={
                    hidden
                      ? tr("隐藏的词条会保留原身份和分组，恢复后重新参与输出。")
                      : query || filter !== "all"
                        ? tr("尝试其他关键词或清除筛选。")
                        : tr("在左侧输入提示词，结构化词条会自动显示在这里。")
                  }
                />
              )}
            </div>
          </section>
          <div className="selection-toolbar">
            <strong>{tr("已选") + " "}{selectedTerms.length}{" " + tr("项")}</strong>
            <span className="selection-divider" />
            <span className="weight-label">{tr("权重")}</span>
            <IconButton
              icon={Minus}
              label={tr("按当前步长减少选中权重")}
              disabled={!weightIds.length || !app.data.valid}
              onClick={() =>
                void safe("editor.weight", {
                  ids: weightIds,
                  value: -app.data.settings.Step,
                  relative: true,
                })
              }
            />
            <input
              className="batch-weight mono"
              aria-label={tr("选中项明确权重")}
              value={batchWeight}
              disabled={hidden || hasNaturalSelection && !weightIds.length}
              onChange={(e) => setBatchWeight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && weightIds.length)
                  void safe("editor.weight", {
                    ids: weightIds,
                    value: batchWeight,
                  });
              }}
              onBlur={() => {
                if (
                  weightIds.length &&
                  batchWeight.trim() &&
                  Number.isFinite(Number(batchWeight))
                )
                  void safe("editor.weight", {
                    ids: weightIds,
                    value: batchWeight,
                  });
              }}
            />
            <IconButton
              icon={Plus}
              label={tr("按当前步长增加选中权重")}
              disabled={!weightIds.length || !app.data.valid}
              onClick={() =>
                void safe("editor.weight", {
                  ids: weightIds,
                  value: app.data.settings.Step,
                  relative: true,
                })
              }
            />
            <span className="spacer" />
            <IconButton
              icon={ArrowCounterClockwise}
              label={hidden ? tr("恢复选中隐藏项") : tr("取消所选项权重")}
              disabled={!(hidden ? selectedIds : weightIds).length || !app.data.valid}
              onClick={() =>
                void safe(hidden ? "editor.restore" : "editor.weight", {
                  ids: hidden ? selectedIds : weightIds,
                  value: null,
                })
              }
            />
            <IconButton
              icon={EyeSlash}
              label={tr("隐藏选中有效项")}
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() => void safe("editor.hide", { ids: selectedIds })}
            />
            <IconButton
              icon={ArrowSquareOut}
              label={tr("移出组成为散项")}
              disabled={!selectedTerms.length || hidden || !app.data.valid}
              onClick={() => void safe("editor.detach", { ids: selectedIds })}
            />
            <IconButton
              icon={Crosshair}
              label={tr("定位原文")}
              disabled={!activeSelected.length || hidden}
              onClick={() => locateTerm()}
            />
            <IconButton
              icon={Star}
              label={tr("收藏选中片段")}
              disabled={!activeSelected.length || hidden || !app.data.valid}
              onClick={() => favoriteForm()}
            />
            <IconButton
              icon={Trash}
              label={tr("删除选中项")}
              disabled={!selectedTerms.length || !app.data.valid}
              onClick={() => void safe("editor.delete", { ids: selectedIds })}
            />
            <IconButton
              icon={X}
              label={tr("清除选择")}
              disabled={!selected.length}
              onClick={() => setSelected([])}
            />
          </div>
        </div>
        {lookup && (
          <Panel
            title={tr("查词与收藏")}
            className="lookup-panel"
            actions={
              <IconButton
                icon={X}
                label={tr("关闭查词面板")}
                onClick={() => setLookup(false)}
              />
            }
          >
            <div className="lookup-tabs"><Segments label={tr("查词面板内容")} value={lookupTab} onChange={setLookupTab} items={[{value:'lexicon',label:tr("词库")},{value:'favorites',label:tr("收藏")}]}/></div>
            <div className="lookup-search">
              <input
                aria-label={tr("中英文查词")}
                autoFocus
                data-workspace-search
                placeholder={tr("输入英文或中文查词…")}
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
              />
            </div>
            <p className="lookup-result-count">
              {tr("{0}词库 · {1} 个结果", tr(negative ? "消极" : "积极"), lookupItems.length)}
            </p>
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
                    label={tr("插入 {0}", l.Text)}
                    onClick={(e) => {
                      e.stopPropagation();
                      void safe("editor.insert", {
                        text: l.Text,
                      });
                    }}
                  />
                </div>
              ))}
              {!lookupItems.length && <Empty title={tr("输入关键词查找词条")} />}
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
            {lookupTab === "lexicon" && (
              <footer className="lookup-insert">
                <span>{tr("插入到{0}提示词选中位置，无选中时追加到尾部", tr(negative ? "消极" : "积极"))}</span>
                <IconButton
                  icon={ArrowSquareOut}
                  label={tr("插入选中查词结果")}
                  className="primary"
                  disabled={!lookupItems[lookupSelected]}
                  onClick={() => void safe("editor.insert", { text: lookupItems[lookupSelected].Text })}
                />
              </footer>
            )}
          </Panel>
        )}
      </div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}{" "}
      {completion.popup}
      {preview !== null && (
        <Modal
          title={tr("复制输出预览")}
          width={800}
          onClose={() => setPreview(null)}
          footer={
            <>
              <span className="hint">{tr("输出全部有效项，隐藏项不参与输出。自然语言提示词保留独立一行。")}</span>
              <span className="spacer" />
              <button onClick={() => setPreview(null)}>{tr("关闭")}</button>
              <button
                className="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(preview);
                  app.notify(tr("已复制完整输出"));
                }}
              >
                <Copy size={16} />{tr("复制全部")}</button>
            </>
          }
        >
          <pre className="output-preview large">
            {preview || tr("暂无有效输出")}
          </pre>
        </Modal>
      )}
    </div>
  );
}
