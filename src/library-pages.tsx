import { tr } from "./i18n";
import { openProbe } from "./comfy-probe";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Archive,
  Plus,
  Star,
  PencilSimple,
  DotsThree,
  Copy,
  ArrowUpRight,
  Trash,
  ArrowsClockwise,
  FolderOpen,
  DownloadSimple,
  Tag,
  FunnelX,
  FloppyDisk,
  ArrowCounterClockwise,
  Link as LinkIcon,
  MagnifyingGlass,
  X,
  Stack,
  ArrowsOut,
  Flask,
  ArrowLeft,
  Info,
} from "@phosphor-icons/react";
import { useApp } from "./context";
import {
  Panel,
  PageHeading,
  IconButton,
  Field,
  Segments,
  Switch,
  Notice,
  Empty,
  Modal,
  Menu,
  ReferenceImages,
  AsyncImage,
  type MenuItem,
} from "./ui";
import { rpc, pick, savePath, openExternal, reveal } from "./api";
import {
  categories,
  builtinCategories,
  type Builtin,
  type Favorite,
  type LoraAsset,
} from "./types";
import { FavoriteForm } from "./editor-page";
export function BuiltinForm({
  entry,
  onClose,
}: {
  entry?: Builtin;
  onClose: () => void;
}) {
  const app = useApp();
  const [value, setValue] = useState<Builtin>(
    entry || {
      Id: "",
      Name: "",
      English: "",
      Category: "角色",
      Subcategory: "",
      Text: "",
      Appearance: "",
      Notes: "",
      Source: "用户新建",
      SourceData: "",
      Modified: false,
      Starred: false,
      LastUsed: 0,
    },
  );
  const [error, setError] = useState("");
  return (
    <Modal
      title={entry?.Id ? tr("编辑内置词条") : tr("新建内置词条")}
      width={840}
      onClose={onClose}
      footer={
        <>
          <span className="hint">{tr("本机修改独立保存，不改写内置基线")}</span>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await app.act("builtin.save", { value });
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >{tr("保存词条")}</button>
        </>
      }
    >
      <div className="form-columns">
        <Field label={tr("显示名称")}>
          <input
            autoFocus
            value={value.Name}
            onChange={(e) => setValue({ ...value, Name: e.target.value })}
          />
        </Field>
        <Field label={tr("英文名称")}>
          <input
            value={value.English}
            onChange={(e) => setValue({ ...value, English: e.target.value })}
          />
        </Field>
      </div>
      <div className="form-columns">
        <Field label={tr("主分类")}>
          <select
            value={value.Category}
            onChange={(e) => setValue({ ...value, Category: e.target.value })}
          >
            {builtinCategories.map((c) => (
              <option key={c} value={c}>{tr(c)}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("子分类")}>
          <input
            value={value.Subcategory}
            onChange={(e) =>
              setValue({ ...value, Subcategory: e.target.value })
            }
          />
        </Field>
      </div>
      <Field label={tr("身份 / 提示词原文")}>
        <textarea
          className="mono"
          rows={3}
          value={value.Text}
          onChange={(e) => setValue({ ...value, Text: e.target.value })}
        />
      </Field>
      <Field label={tr("外貌提示词（可选）")}>
        <textarea
          className="mono"
          rows={3}
          value={value.Appearance}
          onChange={(e) => setValue({ ...value, Appearance: e.target.value })}
        />
      </Field>
      <Field label={tr("备注")}>
        <textarea
          rows={2}
          value={value.Notes}
          onChange={(e) => setValue({ ...value, Notes: e.target.value })}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
export function BuiltinPage() {
  const app = useApp();
  const [category, setCategory] = useState("全部词条");
  const [main, setMain] = useState("全部主分类");
  const [sub, setSub] = useState("全部子分类");
  const [sort, setSort] = useState("名称排序");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    items: Builtin[];
    total: number;
    seedCount: number;
    counts: Record<string, number>;
    subcategories: string[];
    error: string | null;
    filterKey: string;
    pageKey: string;
  }>({
    items: [],
    total: 0,
    seedCount: 55369,
    counts: {},
    subcategories: [],
    error: null,
    filterKey: "",
    pageKey: "",
  });
  const [selection, setSelected] = useState<Builtin | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [mode, setMode] = useState("identity");
  const [target, setTarget] = useState("positive");
  const [createGroup, setCreateGroup] = useState(false);
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const filterKey = JSON.stringify([category, main, sub, query]);
  const pageKey = JSON.stringify([filterKey, sort, offset]);
  const selected = result.filterKey === filterKey ? selection : null;
  const visibleItems = result.pageKey === pageKey ? result.items : [];
  const deleted = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setOffset(0);
    if (list.current) list.current.scrollTop = 0;
  }, [category, main, sub, sort, query]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      const selectedId = selectionRef.current?.Id;
      void rpc<any>("builtin.query", {
        category,
        mainCategory: main,
        subcategory: sub,
        sort,
        text: query,
        offset,
        limit: 100,
        selectedId,
      })
        .then((v) => {
          if (live) {
            setResult({ ...v, filterKey, pageKey });
            setSelected((current) =>
              current?.Id === selectedId ? v.selected || null : current,
            );
          }
        })
        .catch((e) => app.reportError(String(e)))
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 100);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [category, main, sub, sort, query, offset, revision]);
  const reload = async () => {
    setRevision((r) => r + 1);
  };
  const action = async (kind: string) => {
    if (!selected) return;
    try {
      await app.act("builtin.action", { action: kind, id: selected.Id });
      if (kind === "delete") {
        deleted.current = selected.Id;
        setSelected(null);
      }
      await reload();
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const prompt = selected
    ? mode === "appearance"
      ? selected.Appearance
      : mode === "both"
        ? [selected.Text, selected.Appearance].filter(Boolean).join(", ")
        : selected.Text
    : "";
  const edit = (entry?: Builtin) =>
    app.modal(
      <BuiltinForm
        entry={entry}
        onClose={() => {
          app.modal(null);
          void reload();
        }}
      />,
    );
  const archiveMenu = (e: React.MouseEvent) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: tr("备份本机修改…"),
          action: async () => {
            try {
              const path = await savePath("builtin-prompts.backup.json", [
                "json",
              ]);
              if (path) {
                await app.act("builtin.backup", { path });
                app.notify(tr("词库备份已导出"));
              }
            } catch (e) {
              app.reportError(String(e));
            }
          },
        },
        {
          label: tr("恢复词库备份…"),
          action: async () => {
            try {
              const path = await pick({
                filters: [{ name: tr("词库备份"), extensions: ["json"] }],
              });
              if (
                typeof path === "string" &&
                (await app.confirm({
                  title: tr("恢复词库备份？"),
                  body: <p>{tr("将替换本机词库修改；原文件会先生成备份。")}</p>,
                  confirm: tr("恢复备份"),
                })) === "confirm"
              ) {
                await app.act("builtin.restore", { path });
                await reload();
              }
            } catch (e) {
              app.reportError(String(e));
            }
          },
        },
        {
          label: tr("导出原始十五张数据表…"),
          action: async () => {
            try {
              const path = await savePath("source-presets.json", ["json"]);
              if (path) {
                await app.act("builtin.exportSource", { path });
                app.notify(tr("原始数据已导出"));
              }
            } catch (e) {
              app.reportError(String(e));
            }
          },
        },
        {
          label: tr("撤销最近删除"),
          disabled: !deleted.current,
          action: async () => {
            if (deleted.current) {
              await app.act("builtin.action", {
                action: "undelete",
                id: deleted.current,
              });
              deleted.current = null;
              await reload();
            }
          },
        },
      ],
    });
  return (
    <div className="standard-page">
      <PageHeading
        title={tr("内置提示词库")}
        description={tr("{0} 条内置词条 · 离线可用 · 本机修改独立保存", result.seedCount.toLocaleString())}
        status={tr("本机修改受保护保存")}
        actions={
          <>
            <IconButton
              icon={Archive}
              label={tr("备份与恢复词库")}
              onClick={archiveMenu}
            />
            <IconButton
              icon={Plus}
              label={tr("新建内置词条")}
              onClick={() => edit()}
            />
          </>
        }
      />
      <div className="resource-layout">
        <Panel className="resource-categories" title={tr("分类")}>
          <nav>
            {["全部词条", "已星标", "最近应用", ...builtinCategories].map(
              (c) => (
                <button
                  key={c}
                  className={category === c ? "active" : ""}
                  onClick={() => {
                    setCategory(c);
                    setSub("全部子分类");
                    setMain("全部主分类");
                  }}
                >
                  <span>{tr(c)}</span>
                  <small>{result.counts[c]?.toLocaleString() || ""}</small>
                </button>
              ),
            )}
          </nav>
          <p className="hint">{tr("内置基线与本机修改分别保存")}</p>
        </Panel>
        <Panel
          className="resource-records"
          title={tr(category)}
          actions={
            <span className="hint">{result.total.toLocaleString()}{" " + tr("条")}</span>
          }
        >
          <div className="resource-search">
            <div className="search-input">
              <MagnifyingGlass size={16} />
              <input
                aria-label={tr("搜索内置词条")}
                data-workspace-search
                placeholder={tr("搜索中文、英文或原文…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {category === "已星标" && (
              <select
                aria-label={tr("星标主分类")}
                value={main}
                onChange={(e) => {
                  setMain(e.target.value);
                  setSub("全部子分类");
                }}
              >
                <option value="全部主分类">{tr("全部主分类")}</option>
                {builtinCategories.map((c) => (
                  <option key={c} value={c}>{tr(c)}</option>
                ))}
              </select>
            )}
            <div className="form-columns">
              <select
                aria-label={tr("内置词条子分类")}
                value={sub}
                onChange={(e) => setSub(e.target.value)}
              >
                <option value="全部子分类">{tr("全部子分类")}</option>
                {result.subcategories.filter(Boolean).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                aria-label={tr("内置词条排序")}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                {["名称排序", "分类排序", "最近应用"].map((s) => (
                  <option key={s} value={s}>{tr(s)}</option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="virtual-records"
            ref={list}
            role="listbox"
            aria-label={tr("内置词条列表")}
            onScroll={(e) => {
              const next =
                Math.floor(e.currentTarget.scrollTop / 64 / 100) * 100;
              if (next !== offset) setOffset(next);
            }}
          >
            <div style={{ height: result.total * 64, position: "relative" }}>
              {visibleItems.map((b, i) => (
                <button
                  key={b.Id}
                  role="option"
                  aria-selected={selected?.Id === b.Id}
                  className={`resource-row ${selected?.Id === b.Id ? "is-selected" : ""}`}
                  style={{
                    position: "absolute",
                    top: (offset + i) * 64,
                    left: 0,
                    right: 0,
                    height: 64,
                  }}
                  onClick={() => setSelected(b)}
                >
                  <span className="selection-rail" />
                  <strong>
                    {b.Starred ? "★ " : ""}
                    {b.Name}
                  </strong>
                  <small title={b.Text}>
                    {b.Subcategory || b.Category} · {b.English || b.Text}
                  </small>
                </button>
              ))}
            </div>
            {!result.total && (
              <Empty
                title={loading ? tr("正在读取词库…") : tr("没有匹配的词条")}
                description={tr("尝试其他关键词、分类或筛选。")}
              />
            )}
          </div>
          <footer className="panel-footer hint">
            {loading
              ? tr("读取中…")
              : tr("显示 {0}–{1} / {2}", Math.min(offset + 1, result.total), Math.min(offset + 100, result.total), result.total.toLocaleString())}
          </footer>
        </Panel>
        <Panel
          className="resource-detail"
          title={selected?.Name || tr("词条详情")}
          actions={
            selected && (
              <>
                <IconButton
                  icon={Star}
                  label={selected.Starred ? tr("取消星标") : tr("星标当前词条")}
                  active={selected.Starred}
                  onClick={() => void action("star")}
                />
                <IconButton
                  icon={PencilSimple}
                  label={tr("编辑当前词条")}
                  onClick={() => edit(selected)}
                />
                <IconButton
                  icon={DotsThree}
                  label={tr("内置词条管理")}
                  onClick={(e) =>
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        {
                          label: tr("复制为新词条…"),
                          action: () =>
                            edit({
                              ...selected,
                              Id: "",
                              Name: tr("{0} · 副本", selected.Name),
                              Source: "用户新建",
                            }),
                        },
                        {
                          label: tr("恢复内置版本"),
                          disabled: !selected.Modified,
                          action: async () => {
                            if (
                              (await app.confirm({
                                title: tr("恢复内置版本？"),
                                body: <p>{tr("将移除此条目的本机修改。")}</p>,
                                confirm: tr("恢复内置"),
                              })) === "confirm"
                            )
                              await action("restore");
                          },
                        },
                        {
                          label: tr("删除词条"),
                          danger: true,
                          action: async () => {
                            if (
                              (await app.confirm({
                                title: tr("删除此词条？"),
                                body: <p>{tr("删除后可通过管理菜单撤销删除。")}</p>,
                                confirm: tr("删除"),
                                danger: true,
                              })) === "confirm"
                            )
                              await action("delete");
                          },
                        },
                      ],
                    })
                  }
                />
              </>
            )
          }
        >
          {selected ? (
            <>
              <div className="detail-scroll">
                <div className="detail-title">
                  <h2>{selected.Name}</h2>
                  <p>{selected.English}</p>
                  <span className="badge">{selected.Category}</span>
                  <span className="badge">{selected.Subcategory}</span>
                  <span className="badge">
                    {selected.Modified
                      ? tr("内置 · 已修改")
                      : selected.Source === "用户新建"
                        ? tr("自建")
                        : tr("内置")}
                  </span>
                </div>
                <Field label={tr("应用内容")}>
                  <Segments
                    value={mode}
                    onChange={setMode}
                    label={tr("应用内容")}
                    items={[
                      { value: "identity", label: tr("仅身份词") },
                      { value: "appearance", label: tr("仅外貌") },
                      { value: "both", label: tr("身份 + 外貌") },
                    ]}
                  />
                </Field>
                <Field label={tr("提示词预览")}>
                  <pre className="output-preview">
                    {prompt || tr("此条目没有外貌提示词")}
                  </pre>
                </Field>
                {selected.Appearance && (
                  <Field label={tr("外貌")}>
                    <pre className="output-preview">{selected.Appearance}</pre>
                  </Field>
                )}
                {selected.Notes && (
                  <Field label={tr("备注")}>
                    <p>{selected.Notes}</p>
                  </Field>
                )}
                <details className="source-data">
                  <summary>{tr("原始数据 ·") + " "}{selected.Source}</summary>
                  <pre>{selected.SourceData || tr("暂无原始数据")}</pre>
                </details>
              </div>
              <div className="resource-apply">
                <select
                  aria-label={tr("内置词条应用目标")}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="positive">{tr("积极提示词")}</option>
                  <option value="negative">{tr("消极提示词")}</option>
                </select>
                <label className="inline-label">{tr("创建组")}<Switch
                    checked={createGroup}
                    label={tr("应用时创建视觉组")}
                    onChange={setCreateGroup}
                  />
                </label>
                <span
                  className="hint selected-resource-name"
                  title={selected.Name}
                >
                  {selected.Name}
                </span>
                <span className="spacer" />
                <IconButton
                  icon={Copy}
                  label={tr("复制当前应用内容")}
                  disabled={!prompt}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(prompt)
                      .then(() => app.notify(tr("已复制当前应用内容")))
                  }
                />
                <button
                  className="primary"
                  disabled={!prompt}
                  onClick={async () => {
                    try {
                      await app.act("builtin.apply", {
                        id: selected.Id,
                        negative: target === "negative",
                        mode,
                        createGroup,
                      });
                      app.open(target);
                      await reload();
                    } catch (e) {
                      app.reportError(String(e));
                    }
                  }}
                >
                  <Plus size={16} />
                  {target === "negative" ? tr("加入负向提示词") : tr("加入正向提示词")}
                </button>
              </div>
            </>
          ) : (
            <Empty
              title={tr("选择一个词条查看详情")}
              action={
                <button className="primary" disabled>{tr(target === "negative" ? "加入负向提示词" : "加入正向提示词")}</button>
              }
            />
          )}
        </Panel>
      </div>
      {result.error && <Notice error>{result.error}</Notice>}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
export function FavoritesPage() {
  const app = useApp();
  const [category, setCategory] = useState("全部收藏");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState("positive");
  const [sort, setSort] = useState("名称排序");
  const items = useMemo(
    () =>
      app.data.favorites
        .filter(
          (f) =>
            (category === "全部收藏" || f.Category === category) &&
            `${f.Name}\n${f.Text}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "类别排序"
            ? a.Category.localeCompare(b.Category) ||
              a.Name.localeCompare(b.Name)
            : a.Name.localeCompare(b.Name),
        ),
    [app.data.favorites, category, query, sort],
  );
  const f = items.find((f) => f.Id === selected);
  useEffect(() => {
    if (selected && !items.some((item) => item.Id === selected))
      setSelected(null);
  }, [items, selected]);
  const edit = (entry?: Favorite) =>
    app.modal(
      <FavoriteForm favorite={entry} onClose={() => app.modal(null)} />,
    );
  const saveImages = async (images: string[]) => {
    if (!f) return;
    try {
      await app.act("favorites.save", { value: { ...f, Images: images } });
    } catch (e) {
      app.reportError(String(e));
    }
  };
  return (
    <div className="standard-page">
      <PageHeading
        title={tr("收藏与片段")}
        description={tr("收藏片段与已插入的视觉组分别保存。")}
        status={tr("{0} 个片段 · 8 类", app.data.favorites.length)}
        actions={
          <>
            <IconButton
              icon={Star}
              label={tr("新建收藏片段")}
              onClick={() => edit()}
            />
            <IconButton
              icon={Info}
              label={tr("收藏说明")}
              onClick={() =>
                app.notify(
                  tr("收藏选择与收藏全文由工作台单独提供；插入收藏会建立独立视觉组。"),
                )
              }
            />
          </>
        }
      />
      <div className="resource-layout">
        <Panel title={tr("分类")} className="resource-categories">
          <nav>
            {["全部收藏", ...categories].map((c) => (
              <button
                className={category === c ? "active" : ""}
                key={c}
                onClick={() => setCategory(c)}
              >
                <span>{c}</span>
                <small>
                  {c === "全部收藏"
                    ? app.data.favorites.length
                    : app.data.favorites.filter((f) => f.Category === c).length}
                </small>
              </button>
            ))}
          </nav>
          <p className="hint">{tr("八类视觉组可独立管理")}</p>
        </Panel>
        <Panel
          className="resource-records"
          title={tr(category)}
          actions={<span className="hint">{items.length}{" " + tr("个")}</span>}
        >
          <div className="resource-search">
            <input
              aria-label={tr("搜索收藏")}
              data-workspace-search
              placeholder={tr("搜索收藏名称或原文…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label={tr("收藏排序")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="名称排序">{tr("名称排序")}</option>
              <option value="类别排序">{tr("类别排序")}</option>
            </select>
          </div>
          <div className="record-list" role="listbox" aria-label={tr("收藏片段列表")}>
            {items.map((item) => (
              <button
                key={item.Id}
                className={`resource-row ${f?.Id === item.Id ? "is-selected" : ""}`}
                role="option"
                aria-selected={f?.Id === item.Id}
                onClick={() => setSelected(item.Id)}
                onDoubleClick={() =>
                  void app
                    .act("favorites.insert", {
                      id: item.Id,
                      negative: target === "negative",
                    })
                    .then(() => app.open(target))
                    .catch((e) => app.reportError(String(e)))
                }
              >
                <span className="selection-rail" />
                <strong>{item.Name}</strong>
                <small title={item.Text}>
                  {item.Category} · {item.Text}
                </small>
              </button>
            ))}
            {!items.length && (
              <Empty
                title={query ? tr("没有匹配的收藏") : tr("还没有收藏片段")}
                description={tr("在编辑器中选择有效词条后，点击收藏图标。")}
              />
            )}
          </div>
        </Panel>
        <Panel
          className="resource-detail"
          title={f?.Name || tr("收藏详情")}
          actions={
            f && (
              <>
                <IconButton
                  icon={PencilSimple}
                  label={tr("修改收藏名称、类别与原文")}
                  onClick={() => edit(f)}
                />
                <IconButton
                  icon={Trash}
                  label={tr("删除收藏片段")}
                  onClick={async () => {
                    if (
                      (await app.confirm({
                        title: tr("删除收藏片段？"),
                        body: (
                          <p>
                            “{f.Name}{tr("”将从收藏库移除，已插入的视觉组不受影响。")}</p>
                        ),
                        confirm: tr("删除收藏"),
                        danger: true,
                      })) === "confirm"
                    ) {
                      try {
                        await app.act("favorites.delete", { id: f.Id });
                      } catch (e) {
                        app.reportError(String(e));
                      }
                    }
                  }}
                />
              </>
            )
          }
        >
          {f ? (
            <>
              <div className="detail-scroll">
                <div className="detail-title">
                  <h2>{f.Name}</h2>
                  <span className={`badge cat-${f.Category.toLowerCase()}`}>
                    {f.Category}
                  </span>
                </div>
                <ReferenceImages
                  images={f.Images}
                  onChange={(images) => void saveImages(images)}
                />
                <Field label={tr("提示词原文")}>
                  <pre className="output-preview favorite-raw">{f.Text}</pre>
                </Field>
              </div>
              <div className="resource-apply">
                <select
                  aria-label={tr("收藏应用目标")}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="positive">{tr("积极提示词")}</option>
                  <option value="negative">{tr("消极提示词")}</option>
                </select>
                <span className="hint selected-resource-name" title={f.Name}>
                  {f.Name}{" " + tr("· 插入为独立视觉组")}</span>
                <span className="spacer" />
                <IconButton
                  icon={Copy}
                  label={tr("复制收藏原文")}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(f.Text)
                      .then(() => app.notify(tr("收藏原文已复制")))
                  }
                />
                <button
                  className="primary"
                  onClick={() =>
                    void app
                      .act("favorites.insert", {
                        id: f.Id,
                        negative: target === "negative",
                      })
                      .then(() => app.open(target))
                      .catch((e) => app.reportError(String(e)))
                  }
                >
                  <Plus size={16} />
                  {target === "negative" ? tr("加入负向提示词") : tr("加入正向提示词")}
                </button>
              </div>
            </>
          ) : (
            <Empty
              title={tr("选择收藏片段查看详情")}
              action={
                <button className="primary" disabled>{tr(target === "negative" ? "加入负向提示词" : "加入正向提示词")}</button>
              }
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
function InfoIcon(p: any) {
  return (
    <span {...p} className="info-glyph">
      ⓘ
    </span>
  );
}
function SourcesForm({
  roots,
  onSave,
  onClose,
}: {
  roots: string[];
  onSave: (roots: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const app = useApp();
  const [value, setValue] = useState(roots);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={tr("管理模型文件夹")}
      width={760}
      onClose={onClose}
      footer={
        <>
          <span className="hint">{tr("模型文件保持原位，不复制或移动模型")}</span>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(value);
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? tr("扫描中…") : tr("保存并扫描")}
          </button>
        </>
      }
    >
      <div className="source-folders">
        {value.map((p, i) => (
          <div className="input-action" key={i}>
            <input
              aria-label={tr("模型文件夹 {0}", i + 1)}
              value={p}
              onChange={(e) =>
                setValue(value.map((p, j) => (i === j ? e.target.value : p)))
              }
            />
            <IconButton
              icon={Trash}
              label={tr("移除模型文件夹 {0}", p)}
              onClick={() => setValue(value.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <button
        onClick={async () => {
          try {
            const p = await pick({ directory: true, multiple: true });
            if (p)
              setValue([
                ...new Set([...value, ...(Array.isArray(p) ? p : [p])]),
              ]);
          } catch (e) {
            app.reportError(String(e));
          }
        }}
      >
        <FolderOpen size={16} />{tr("添加文件夹")}</button>
      <Notice>{tr("不可用目录会显示错误并保留已有模型资料；失效模型记录仍可检索。")}</Notice>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function TextForm({
  title,
  label,
  initial = "",
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  onSave: (text: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  return (
    <Modal
      title={title}
      width={640}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await onSave(value);
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >{tr("保存")}</button>
        </>
      }
    >
      <Field label={label}>
        <textarea
          autoFocus
          rows={6}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
export function LoraPage() {
  const app = useApp();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<{ Roots: string[]; Items: LoraAsset[] }>({
    Roots: [],
    Items: [],
  });
  const [query, setQuery] = useState("");
  const [base, setBase] = useState("全部基础模型");
  const [folder, setFolder] = useState("全部文件夹");
  const [tag, setTag] = useState("全部标签");
  const [flags, setFlags] = useState({
    favorite: false,
    missing: false,
    added: false,
  });
  const [sort, setSort] = useState("名称排序");
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<LoraAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const anchor = useRef<string | null>(null);
  const original = useRef("");
  const [listOffset, setListOffset] = useState(0);
  const nameCopy = (names: string[]) => {
    const values = names.map((name) => {
      let n = app.data.settings.LoraCopyIncludeDirectory
        ? name
        : name.split(/[\\/]/).at(-1) || name;
      if (!app.data.settings.LoraCopyIncludeExtension)
        n = n.replace(/\.[^.]+$/, "");
      return n;
    });
    void navigator.clipboard
      .writeText(values.join("\n"))
      .then(() => app.notify(tr("已复制 {0} 个模型名称", values.length)));
  };
  const load = async () => {
    const next = await rpc<any>("lora.get");
    setData(next);
    if (draft) {
      const item = next.Items.find((i: LoraAsset) => i.Id === draft.Id);
      if (item && JSON.stringify(draft) === original.current) {
        setDraft(structuredClone(item));
        original.current = JSON.stringify(item);
      }
    }
  };
  useEffect(() => {
    void load().catch((e) => app.reportError(String(e)));
  }, []);
  const dirty = !!draft && JSON.stringify(draft) !== original.current;
  const save = async () => {
    if (!draft) return;
    await app.act("lora.save", { value: draft });
    original.current = JSON.stringify(draft);
    await load();
    app.notify(tr("LoRA 资料已保存"));
  };
  const guard = async () => {
    if (!dirty) return true;
    const result = await app.confirm({
      title: tr("保存模型资料修改？"),
      body: <p>{tr("当前模型资料有未保存的修改。")}</p>,
      confirm: tr("保存资料"),
      third: tr("不保存"),
    });
    if (result === "cancel") return false;
    if (result === "confirm") {
      try {
        await save();
      } catch (e) {
        setError(String(e));
        return false;
      }
    }
    if (result === "third" && draft) {
      const item = data.Items.find((x) => x.Id === draft.Id);
      if (item) {
        setDraft(structuredClone(item));
        original.current = JSON.stringify(item);
        setError("");
      }
    }
    return true;
  };
  useEffect(() => {
    app.draftGuards.current.set("lora", guard);
    return () => {
      app.draftGuards.current.delete("lora");
    };
  }, [dirty, draft]);
  const items = useMemo(
    () =>
      data.Items.filter(
        (x) =>
          query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .every((q) =>
              `${x.Name}\n${x.Aliases}\n${x.Series}\n${x.BaseModel}\n${x.FilePath}\n${x.ModelKey}\n${x.Tags.join(" ")}\n${x.Triggers}\n${x.Notes}\n${x.Links.join(" ")}`
                .toLowerCase()
                .includes(q),
            ) &&
          (base === "全部基础模型" || x.BaseModel === base) &&
          (folder === "全部文件夹" || x.Root === folder) &&
          (tag === "全部标签" || x.Tags.includes(tag)) &&
          (!flags.favorite || x.Favorite) &&
          (!flags.missing || x.Missing) &&
          (!flags.added ||
            app.data.generation.model_controls.lora.loras.some(
              (l) => l.name === x.ModelKey,
            )),
      ).sort((a, b) =>
        sort === "文件大小"
          ? b.Size - a.Size
          : sort === "收藏优先"
            ? Number(b.Favorite) - Number(a.Favorite) ||
              a.Name.localeCompare(b.Name)
            : a.Name.localeCompare(b.Name),
      ),
    [data, query, base, folder, tag, flags, sort, app.data.generation],
  );
  const choose = async (item: LoraAsset, e: React.MouseEvent) => {
    // The second click belongs to expansion, not a second navigation/guard.
    if (e.detail > 1) return;
    if (draft?.Id !== item.Id && !(await guard())) return;
    const at = items.indexOf(item);
    if (e.shiftKey && anchor.current) {
      const from = items.findIndex((x) => x.Id === anchor.current);
      setSelected(
        items
          .slice(Math.min(from, at), Math.max(from, at) + 1)
          .map((x) => x.Id),
      );
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) =>
        prev.includes(item.Id)
          ? prev.filter((s) => s !== item.Id)
          : [...prev, item.Id],
      );
      anchor.current = item.Id;
    } else {
      setSelected([item.Id]);
      anchor.current = item.Id;
    }
    if (draft?.Id !== item.Id) {
      setDraft(structuredClone(item));
      original.current = JSON.stringify(item);
      setError("");
    }
  };
  const scan = async (roots?: string[]) => {
    setBusy(true);
    try {
      const result = await app.act<any>(roots ? "lora.scan" : "lora.refresh", roots ? { roots } : {});
      setData(result.data);
      if (result.warnings.length) app.notify(result.warnings.join("\n"));
    } finally {
      setBusy(false);
    }
  };
  const batch = async (action: string, p: any = {}) => {
    await app.act("lora.batch", { ids: selected, action, ...p });
    await load();
  };
  const controller = async (ids: string[], single = false) => {
    setBusy(true);
    try {
      const result = await app.act<any>("lora.controller", { ids });
      const answer = await app.confirm({
        title: tr("核对模型并添加到控制器"),
        body: (
          <>
            <p>{tr("已核对") + " "}{result.entries.length}{" " + tr("个模型的 ComfyUI 文件标识。")}</p>
            <p className="hint">{tr("目标 LoRA Manager：")}{result.target
                ? `#${result.target}`
                : tr("尚未选择目标节点；请在模型控制页选择")}
            </p>
            <div className="controller-confirm-list">
              {result.entries.map((x: any, i: number) => (
                <div key={i}>
                  <span className="mono">{x.name}</span>
                  <span>
                    Model {x.strength} · CLIP {x.clipStrength}
                  </span>
                </div>
              ))}
            </div>
          </>
        ),
        confirm: single ? tr("添加模型") : tr("整批添加"),
      });
      if (answer === "confirm") {
        await app.act("lora.controller", { ids, confirm: true });
        app.notify(tr("已添加到 LoRA 控制器"));
      }
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const insertTriggers = async (item: LoraAsset, createGroup: boolean) => {
    try {
      await app.act("lora.triggers.insert", { text: item.Triggers, name: item.Name, createGroup });
      app.open(app.data.project.State.IsNegative ? "negative" : "positive");
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const sources = () =>
    app.modal(
      <SourcesForm
        roots={data.Roots}
        onSave={scan}
        onClose={() => app.modal(null)}
      />,
    );
  const addLinks = (index?: number) =>
    app.modal(
      <TextForm
        title={index == null ? tr("新增 LoRA 链接") : tr("修改 LoRA 链接")}
        label={index == null ? tr("每行一个网页链接") : tr("网页链接")}
        initial={index == null ? "" : draft?.Links[index]}
        onClose={() => app.modal(null)}
        onSave={(text) => {
          const values = text
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const u = new URL(s.includes("://") ? s : `https://${s}`);
              if (!["http:", "https:"].includes(u.protocol))
                throw Error(tr("仅支持 http / https 网页地址"));
              return u.href;
            });
          if (!values.length) throw Error(tr("请至少输入一条链接"));
          if (index != null && values.length !== 1)
            throw Error(tr("单条编辑只允许一个链接"));
          if (draft)
            setDraft({
              ...draft,
              Links:
                index == null
                  ? [...new Set([...draft.Links, ...values])]
                  : draft.Links.map((s, i) => (i === index ? values[0] : s)),
            });
        }}
      />,
    );
  return (
    <div className={`standard-page ${expanded ? "lora-expanded" : ""}`}>
      <PageHeading
        title={expanded ? tr("模型资料") : tr("LoRA 模型库")}
        description={
          expanded
            ? `${draft?.Name || ""} · ${draft?.ModelKey || ""}`
            : tr("本机模型文件保持原位；封面、触发词和资料独立保存。")
        }
        status={
          busy
            ? tr("正在读取模型…")
            : dirty
              ? tr("模型资料有未保存修改")
              : tr("离线资料可用")
        }
        actions={
          expanded ? (
            <>
              <IconButton
                icon={ArrowLeft}
                label={tr("返回 LoRA 模型库")}
                onClick={() => setExpanded(false)}
              />
              <IconButton
                icon={FolderOpen}
                label={tr("打开模型文件夹")}
                onClick={() => {
                  if (draft) void reveal(draft.FilePath);
                }}
              />
              <IconButton
                icon={FloppyDisk}
                label={tr("保存资料修改")}
                className="primary"
                disabled={!dirty}
                onClick={() => void save().catch((e) => setError(String(e)))}
              />
            </>
          ) : (
            <>
              <IconButton
                icon={DownloadSimple}
                label={tr("读取 ComfyUI 目录与模型资料")}
                disabled={busy}
                onClick={async () => {
                  if (!(await guard())) return;
                  setBusy(true);
                  try {
                    const result = await app.act<any>("lora.readComfy");
                    setData(result.data);
                    if (result.warnings.length)
                      app.notify(result.warnings.join("\n"));
                  } catch (e) {
                    app.reportError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <IconButton
                icon={FolderOpen}
                label={tr("管理本机模型文件夹")}
                disabled={busy}
                onClick={sources}
              />
              <IconButton
                icon={ArrowsClockwise}
                label={tr("刷新 LoRA 模型库")}
                disabled={busy}
                onClick={() => void scan().catch((e) => app.reportError(String(e)))}
              />
            </>
          )
        }
      />
      <div className="lora-layout">
        <Panel className="lora-filters">
          <div className="lora-filter-top">
            <div className="search-input">
              <MagnifyingGlass size={16} />
              <input
                aria-label={tr("搜索 LoRA 模型")}
                data-workspace-search
                placeholder={tr("搜索名称、别名、作品、触发词或标签…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label={tr("基础模型筛选")}
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              <option value="全部基础模型">{tr("全部基础模型")}</option>
              {[...new Set(data.Items.map((i) => i.BaseModel).filter(Boolean))]
                .sort()
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
            <select
              aria-label={tr("模型文件夹筛选")}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="全部文件夹">{tr("全部文件夹")}</option>
              {data.Roots.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label={tr("模型标签筛选")}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            >
              <option value="全部标签">{tr("全部标签")}</option>
              {[...new Set(data.Items.flatMap((i) => i.Tags))]
                .sort()
                .map((v) => (
                  <option key={v}>{v}</option>
                ))}
            </select>
            <IconButton
              icon={FunnelX}
              label={tr("清空所有 LoRA 筛选")}
              onClick={() => {
                setQuery("");
                setBase("全部基础模型");
                setFolder("全部文件夹");
                setTag("全部标签");
                setFlags({ favorite: false, missing: false, added: false });
              }}
            />
          </div>
          <div className="lora-filter-bottom">
            {(
              [
                ["favorite", tr("仅收藏")],
                ["missing", tr("仅缺失")],
                ["added", tr("已添加")],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={(e) =>
                    setFlags({ ...flags, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
            <span className="hint">
              {items.length} / {data.Items.length}{" " + tr("个模型")}</span>
            <span className="spacer" />
            <select
              aria-label={tr("LoRA 排序")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="名称排序">{tr("名称排序")}</option>
              <option value="文件大小">{tr("文件大小")}</option>
              <option value="收藏优先">{tr("收藏优先")}</option>
            </select>
            <IconButton
              icon={Tag}
              label={tr("批量添加标签")}
              disabled={!selected.length}
              onClick={() =>
                app.modal(
                  <TextForm
                    title={tr("批量添加标签")}
                    label={tr("将标签添加到选中的 {0} 个模型（逗号或换行分隔）", selected.length)}
                    onSave={(text) => batch("tags", { tags: text })}
                    onClose={() => app.modal(null)}
                  />,
                )
              }
            />
            <IconButton
              icon={Star}
              label={tr("批量收藏选中模型")}
              disabled={!selected.length}
              onClick={() =>
                void batch("favorite", { favorite: true }).catch((e) =>
                  app.reportError(String(e)),
                )
              }
            />
            <IconButton
              icon={Copy}
              label={tr("复制选中模型名称")}
              disabled={!selected.length}
              onClick={() =>
                nameCopy(
                  data.Items.filter((i) => selected.includes(i.Id)).map(
                    (i) => i.ModelKey || i.FilePath,
                  ),
                )
              }
            />
            <IconButton
              icon={ArrowUpRight}
              label={tr("核对后整批加入控制器")}
              className="primary"
              disabled={!selected.length || busy}
              onClick={() => void controller(selected)}
            />
          </div>
        </Panel>
        <Panel
          className="lora-records"
          title={tr("模型")}
          actions={<span className="hint">{tr("已选") + " "}{selected.length}{" " + tr("项")}</span>}
        >
          <div
            className="lora-record-list"
            role="listbox"
            aria-label={tr("LoRA 模型列表")}
            aria-multiselectable="true"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
                e.preventDefault();
                setSelected(items.map((x) => x.Id));
              }
            }}
            onScroll={(e) =>
              setListOffset(
                Math.max(0, Math.floor(e.currentTarget.scrollTop / 80) - 3),
              )
            }
          >
            <div style={{ height: items.length * 80, position: "relative" }}>
              {items.slice(listOffset, listOffset + 20).map((item, i) => (
                <button
                  key={item.Id}
                  style={{
                    position: "absolute",
                    top: (listOffset + i) * 80,
                    left: 0,
                    right: 0,
                    height: 80,
                  }}
                  className={`lora-record-row ${selected.includes(item.Id) ? "is-selected" : ""}`}
                  role="option"
                  aria-selected={selected.includes(item.Id)}
                  onClick={(e) => void choose(item, e)}
                  onDoubleClick={() => {
                    if (draft?.Id === item.Id) setExpanded(true);
                  }}
                >
                  <span className="selection-rail" />
                  <div className="lora-thumbnail">
                    {item.Images[0] ? (
                      <AsyncImage path={item.Images[0]} alt={tr("模型封面")} />
                    ) : (
                      <img src="/icon.png" alt={tr("默认封面")} />
                    )}
                  </div>
                  <span>
                    <strong>
                      {item.Favorite ? "★ " : ""}
                      {item.Name}
                    </strong>
                    <small>
                      {item.Aliases ||
                        item.Series ||
                        item.BaseModel ||
                        tr("未填写基础模型")}
                    </small>
                    <small title={item.ModelKey || item.FilePath}>
                      {item.Missing ? tr("文件缺失 · ") : ""}
                      {item.ModelKey || item.FilePath}
                    </small>
                  </span>
                  <small>{(item.Size / 1024 / 1024).toFixed(1)} MB</small>
                </button>
              ))}
            </div>
            {!items.length && (
              <Empty
                title={
                  data.Items.length
                    ? tr("没有匹配的模型")
                    : tr("添加你的第一个模型文件夹")
                }
                description={tr("扫描本机目录，或读取 ComfyUI 的 LoRA 目录。")}
                action={
                  <button onClick={sources}>
                    <FolderOpen size={16} />{tr("管理文件夹")}</button>
                }
              />
            )}
          </div>
        </Panel>
        <Panel
          className="lora-detail"
          title={draft?.Name || tr("模型资料")}
          actions={
            draft && (
              <>
                <IconButton icon={Flask} label={tr("试试该 LoRA 的效果")} onClick={() => openProbe(draft.ModelKey,"lora")}/>
                <IconButton icon={ArrowUpRight} label={tr("将当前 LoRA 加入控制器")}
                  disabled={busy} onClick={() => void controller([draft.Id], true)} />
                <IconButton
                  icon={ArrowsOut}
                  label={tr("展开模型资料")}
                  onClick={() => setExpanded(true)}
                />
                <IconButton
                  icon={FolderOpen}
                  label={tr("打开模型所在文件夹")}
                  onClick={() =>
                    void reveal(draft.FilePath).catch((e) =>
                      app.reportError(String(e)),
                    )
                  }
                />
                <IconButton
                  icon={ArrowCounterClockwise}
                  label={tr("放弃资料修改")}
                  disabled={!dirty}
                  onClick={() => {
                    const item = data.Items.find((x) => x.Id === draft.Id);
                    if (item) {
                      setDraft(structuredClone(item));
                      original.current = JSON.stringify(item);
                      setError("");
                    }
                  }}
                />
                <IconButton
                  icon={FloppyDisk}
                  label={tr("保存模型资料")}
                  className="primary"
                  disabled={!dirty}
                  onClick={() => void save().catch((e) => setError(String(e)))}
                />
              </>
            )
          }
        >
          {draft ? (
            <div className="detail-scroll">
              <div className="detail-title">
                <h2>{draft.Name}</h2>
                <p className="mono path" title={draft.FilePath}>
                  {draft.ModelKey || draft.FilePath}
                </p>
                {draft.Missing && (
                  <Notice error>{tr("模型文件缺失，已保留资料与参考图。")}</Notice>
                )}
              </div>
              <ReferenceImages
                images={draft.Images}
                sourceImages={draft.SourceImages}
                onChange={(images) => setDraft({ ...draft, Images: images })}
              />
              <section className="lora-metadata-form">
                <h3>{tr("模型资料")}</h3>
                <div className="form-columns">
                  <Field label={tr("显示名称")}>
                    <input
                      value={draft.Name}
                      onChange={(e) =>
                        setDraft({ ...draft, Name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={tr("角色别名")}>
                    <input
                      value={draft.Aliases}
                      onChange={(e) =>
                        setDraft({ ...draft, Aliases: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <div className="form-columns">
                  <Field label={tr("作品 / 系列")}>
                    <input
                      value={draft.Series}
                      onChange={(e) =>
                        setDraft({ ...draft, Series: e.target.value })
                      }
                    />
                  </Field>
                  <Field label={tr("基础模型")}>
                    <input
                      value={draft.BaseModel}
                      onChange={(e) =>
                        setDraft({ ...draft, BaseModel: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label={tr("标签（逗号分隔）")}>
                  <input
                    value={draft.Tags.join(", ")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        Tags: e.target.value
                          .split(/[,，;；\n]/)
                          .map((s) => s.trim()),
                      })
                    }
                    onBlur={() =>
                      setDraft({
                        ...draft,
                        Tags: [...new Set(draft.Tags.filter(Boolean))],
                      })
                    }
                  />
                </Field>
                <div className="form-columns">
                  <Field label={tr("推荐 Model 强度")}>
                    <input
                      type="number"
                      min="-20"
                      max="20"
                      step="0.1"
                      value={draft.Strength}
                      onChange={(e) =>
                        setDraft({ ...draft, Strength: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={tr("推荐 CLIP 强度")}>
                    <input
                      type="number"
                      min="-20"
                      max="20"
                      step="0.1"
                      value={draft.ClipStrength}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          ClipStrength: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <label className="inline-label">{tr("收藏模型")}<Switch
                      checked={draft.Favorite}
                      label={tr("收藏此模型")}
                      onChange={(v) => setDraft({ ...draft, Favorite: v })}
                    />
                  </label>
                </div>
                <div className="lora-trigger-field">
                <div className="lora-trigger-actions">
                  <IconButton icon={Copy} label={tr("复制触发词")} disabled={!draft.Triggers.trim()}
                    onClick={() => void navigator.clipboard.writeText(draft.Triggers)
                      .then(() => app.notify(tr("已复制触发词"))).catch((e) => app.reportError(String(e)))} />
                  <IconButton icon={Plus} label={tr("插入触发词")} disabled={!draft.Triggers.trim()}
                    onClick={() => void insertTriggers(draft, false)} />
                  <IconButton icon={Stack} label={tr("将触发词作为组插入")} disabled={!draft.Triggers.trim()}
                    onClick={() => void insertTriggers(draft, true)} />
                </div>
                <Field label={tr("触发词")}>
                  <textarea
                    rows={Math.max(
                      2,
                      Math.min(8, draft.Triggers.split("\n").length + 1),
                    )}
                    className="mono"
                    value={draft.Triggers}
                    onChange={(e) =>
                      setDraft({ ...draft, Triggers: e.target.value })
                    }
                  />
                </Field>
                </div>
                <Field label={tr("备注")}>
                  <textarea
                    rows={3}
                    value={draft.Notes}
                    onChange={(e) =>
                      setDraft({ ...draft, Notes: e.target.value })
                    }
                  />
                </Field>
              </section>
              <section className="lora-links-panel">
                <div className="links-heading">
                  <h3>Link</h3>
                  <IconButton
                    icon={Plus}
                    label={tr("批量新增网页链接")}
                    onClick={() => addLinks()}
                  />
                </div>
                <div className="model-links">
                  {draft.Links.map((link, i) => (
                    <div key={i}>
                      <LinkIcon size={16} />
                      <button
                        className="text-link"
                        title={link}
                        onClick={() =>
                          void openExternal(link).catch((e) =>
                            app.reportError(String(e)),
                          )
                        }
                      >
                        {link}
                      </button>
                      <IconButton
                        icon={PencilSimple}
                        label={tr("修改链接 {0}", i + 1)}
                        onClick={() => addLinks(i)}
                      />
                      <IconButton
                        icon={Trash}
                        label={tr("删除链接 {0}", i + 1)}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            Links: draft.Links.filter((_, j) => j !== i),
                          })
                        }
                      />
                      <IconButton
                        icon={ArrowUpRight}
                        label={tr("打开链接 {0}", i + 1)}
                        onClick={() =>
                          void openExternal(link).catch((e) =>
                            app.reportError(String(e)),
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
              {error && <Notice error>{error}</Notice>}
              <p className="hint lora-detail-footnote">{tr("修改后点击“保存资料”。LoRA 文件内容不会被改写。")}</p>
            </div>
          ) : (
            <Empty title={tr("选择模型查看资料")} />
          )}
        </Panel>
      </div>
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
