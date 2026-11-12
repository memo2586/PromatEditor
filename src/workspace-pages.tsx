import { tr, type LanguagePreference } from "./i18n";
import { useState, useEffect } from "react";
import {
  Plus,
  PencilSimple,
  Trash,
  Info,
  ArrowCounterClockwise,
  ArrowLeft,
  FolderOpen,
  ArrowsClockwise,
  ImageSquare,
  X,
  Copy,
  ArrowUpRight,
  ClockCounterClockwise,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useApp } from "./context";
import {
  Panel,
  PageHeading,
  IconButton,
  Field,
  Switch,
  Notice,
  Modal,
  Empty,
  AsyncImage,
  Segments,
} from "./ui";
import { rpc, pick } from "./api";
import { ComfySettings } from "./comfy-process";
const colors = [
  "#087E73",
  "#166534",
  "#047857",
  "#0F766E",
  "#155E75",
  "#075985",
  "#1D4ED8",
  "#1E40AF",
  "#4338CA",
  "#5B21B6",
  "#6D28D9",
  "#7E22CE",
  "#86198F",
  "#A21CAF",
  "#9D174D",
  "#BE185D",
  "#9F1239",
  "#B91C1C",
  "#C2410C",
  "#9A3412",
  "#854D0E",
  "#A16207",
  "#475569",
  "#334155",
];
function NameForm({
  title,
  initial = "",
  onSave,
  onClose,
}: {
  title: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  return (
    <Modal
      title={title}
      width={520}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>{tr("取消")}</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                if (!name.trim()) throw Error(tr("名称不能为空"));
                await onSave(name.trim());
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >{tr("保存")}</button>
        </>
      }
    >
      <Field label={tr("名称")}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim())
              void onSave(name.trim())
                .then(onClose)
                .catch((e) => setError(String(e)));
          }}
        />
      </Field>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
type Diff = {
  Workspace: string;
  Kind: string;
  Term: string;
  Before: string;
  After: string;
};
export function SnapshotsPage() {
  const app = useApp();
  const snapshots = app.data.project.Snapshots;
  const [before, setBefore] = useState(snapshots[0]?.Id || "current");
  const [after, setAfter] = useState("current");
  const [diff, setDiff] = useState<Diff[]>([]);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState("全部工作区");
  const [filter, setFilter] = useState("全部差异");
  useEffect(() => {
    if (before !== "current" && !snapshots.some((s) => s.Id === before))
      setBefore("current");
    if (after !== "current" && !snapshots.some((s) => s.Id === after))
      setAfter("current");
  }, [snapshots]);
  useEffect(() => {
    let live = true;
    void rpc<Diff[]>("snapshots.compare", { before, after })
      .then((v) => {
        if (live) setDiff(v);
      })
      .catch((e) => app.reportError(String(e)));
    return () => {
      live = false;
    };
  }, [before, after, app.data.project, app.data.generation]);
  const selected = snapshots.find((s) => s.Id === before);
  const name = (kind: "create" | "rename") =>
    app.modal(
      <NameForm
        title={kind === "create" ? tr("新建双工作区快照") : tr("重命名快照")}
        initial={
          kind === "create" ? tr("快照 {0}", snapshots.length + 1) : selected?.Name
        }
        onSave={async (name) => {
          for (const flush of app.draftFlushers.current.values()) await flush();
          await app.act(`snapshots.${kind}`, { id: selected?.Id, name });
        }}
        onClose={() => app.modal(null)}
      />,
    );
  const visible = diff.filter(
    (d) =>
      (workspace === "全部工作区" || d.Workspace === workspace) &&
      (filter === "全部差异" || d.Kind === filter) &&
      `${d.Term} ${d.Before} ${d.After}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const restore = async () => {
    if (!selected) return;
    if (
      (await app.confirm({
        title: tr("恢复双工作区快照？"),
        body: (
          <p>{tr("积极和消极工作区将恢复为“")}{selected.Name}{tr("”的正文、权重、隐藏项、视觉组与成员、工作流分组、生成参数和模型设置；旧快照未保存参数时保留当前参数。可通过撤销恢复当前内容。")}</p>
        ),
        confirm: tr("恢复快照"),
      })) === "confirm"
    ) {
      try {
        for (const flush of app.draftFlushers.current.values()) await flush();
        await app.act("snapshots.restore", { id: selected.Id });
        app.notify(tr("快照已恢复 · 包含已保存的参数与模型"));
      } catch (e) {
        app.reportError(String(e));
      }
    }
  };
  return (
    <div className="standard-page">
      <PageHeading
        title={tr("快照与对比")}
        description={tr("快照保存两个工作区、视觉组与成员、生成参数和模型；对比忽略视觉组归属及顺序变化。")}
        status={tr("{0} 处差异", diff.length)}
        actions={
          <>
            <IconButton
              icon={Plus}
              label={tr("新建快照")}
              onClick={() => name("create")}
            />
            <IconButton
              icon={Info}
              label={tr("快照说明")}
              onClick={() =>
                app.notify(
                  tr("可对比任意两个快照或当前状态；恢复快照支持一次撤销。"),
                )
              }
            />
          </>
        }
      />
      <div className="snapshots-layout">
        <Panel
          className="snapshot-list-panel"
          title={tr("项目快照")}
          actions={<span className="hint">{snapshots.length}{" " + tr("个")}</span>}
        >
          <div className="snapshot-list">
            <button
              className={`snapshot-row ${before === "current" ? "is-selected" : ""}`}
              onClick={() => setBefore("current")}
            >
              <span className="selection-rail" />
              <strong>{tr("当前编辑状态")}</strong>
              <small>{tr("积极 / 消极工作区")}</small>
            </button>
            {snapshots.map((s) => (
              <button
                key={s.Id}
                className={`snapshot-row ${before === s.Id ? "is-selected" : ""}`}
                onClick={() => setBefore(s.Id)}
              >
                <span className="selection-rail" />
                <strong>{s.Name}</strong>
                <small>{s.Created}</small>
                <small>
                  {s.State.Positive.Active.length}{" " + tr("积极 ·")}{" "}
                  {s.State.Negative.Active.length}{" " + tr("消极")}</small>
              </button>
            ))}
            {!snapshots.length && (
              <Empty
                title={tr("还没有快照")}
                description={tr("记录当前两个工作区，随时比较和恢复。")}
              />
            )}
          </div>
          <footer className="snapshot-actions">
            <IconButton
              icon={Plus}
              label={tr("新建双工作区快照")}
              onClick={() => name("create")}
            />
            <IconButton
              icon={PencilSimple}
              label={tr("重命名选中快照")}
              disabled={!selected}
              onClick={() => name("rename")}
            />
            <IconButton
              icon={Trash}
              label={tr("删除选中快照")}
              disabled={!selected}
              onClick={async () => {
                if (
                  selected &&
                  (await app.confirm({
                    title: tr("删除此快照？"),
                    body: (
                      <p>
                        “{selected.Name}{tr("”将被删除，当前工作区不受影响，可通过撤销恢复。")}</p>
                    ),
                    confirm: tr("删除快照"),
                    danger: true,
                  })) === "confirm"
                ) {
                  try {
                    await app.act("snapshots.delete", { id: selected.Id });
                  } catch (e) {
                    app.reportError(String(e));
                  }
                }
              }}
            />
            <span className="spacer" />
            <IconButton
              icon={ArrowCounterClockwise}
              label={tr("恢复选中快照")}
              disabled={!selected}
              onClick={restore}
            />
          </footer>
        </Panel>
        <Panel title={tr("状态对比")} className="snapshot-compare">
          <div className="comparison-controls">
            <Field label={tr("基准状态")}>
              <select
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              >
                <option value="current">{tr("当前编辑状态")}</option>
                {snapshots.map((s) => (
                  <option key={s.Id} value={s.Id}>
                    {s.Name}
                  </option>
                ))}
              </select>
            </Field>
            <ArrowUpRight size={18} />
            <Field label={tr("对比状态")}>
              <select value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value="current">{tr("当前编辑状态")}</option>
                {snapshots.map((s) => (
                  <option key={s.Id} value={s.Id}>
                    {s.Name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="comparison-filters">
            <input
              aria-label={tr("搜索差异")}
              data-workspace-search
              placeholder={tr("搜索词条或差异内容…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label={tr("差异工作区")}
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            >
              <option value="全部工作区">{tr("全部工作区")}</option>
              <option value="积极">{tr("积极")}</option>
              <option value="消极">{tr("消极")}</option>
              <option value="生成参数">{tr("生成参数")}</option>
              <option value="工作流">{tr("工作流")}</option>
              <option value="模型">{tr("模型")}</option>
            </select>
            <select
              aria-label={tr("差异类型")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="全部差异">{tr("全部差异")}</option>
              {[...new Set(diff.map((d) => d.Kind))].map((s) => (
                <option key={s} value={s}>{tr(s)}</option>
              ))}
            </select>
          </div>
          <div className="diff-table">
            <div className="diff-header">
              <span>{tr("工作区")}</span>
              <span>{tr("变化")}</span>
              <span>{tr("词条 / 组")}</span>
              <span>{tr("基准值")}</span>
              <span>{tr("对比值")}</span>
            </div>
            {visible.map((d, i) => (
              <div className="diff-row" key={i}>
                <span>{tr(d.Workspace)}</span>
                <span className="badge">{tr(d.Kind)}</span>
                <span title={d.Term}>{d.Term}</span>
                <span className="diff-before" title={d.Before}>
                  {d.Before}
                </span>
                <span className="diff-after" title={d.After}>
                  {d.After}
                </span>
              </div>
            ))}
            {!visible.length && (
              <Empty
                title={
                  before === after
                    ? tr("选择两个不同的状态进行比较")
                    : tr("两个状态之间没有匹配的差异")
                }
                description={tr("差异包含原文、权重、隐藏、组属性、成员归属及顺序。")}
              />
            )}
          </div>
          <footer className="panel-footer hint">
            {visible.length}{" " + tr("处差异 · 仅查看，不修改当前项目")}</footer>
        </Panel>
      </div>
    </div>
  );
}
export function SettingsPage() {
  const app = useApp();
  const [section, setSection] = useState(
    () => sessionStorage.getItem("settings-section") || "appearance",
  );
  useEffect(() => {
    const select = () =>
      setSection(sessionStorage.getItem("settings-section") || "appearance");
    window.addEventListener("settings-section", select);
    return () => window.removeEventListener("settings-section", select);
  }, []);
  const s = app.data.settings;
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const lightAppearance =
    s.ThemeMode === "light" || (s.ThemeMode === "system" && !systemDark);
  const [step, setStep] = useState(String(s.Step));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState(app.data.dataDirectory);
  const [fonts, setFonts] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void app
      .act<string[]>("system.fonts")
      .then((list) => {
        if (active && Array.isArray(list)) setFonts(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const set = async (patch: Partial<typeof s>) => {
    try {
      await app.act("settings.set", { value: { ...s, ...patch } });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const loadExcel = async (choose = false) => {
    setBusy(true);
    try {
      let path: string | undefined;
      if (choose) {
        const p = await pick({
          filters: [{ name: tr("统计 Excel 词库"), extensions: ["xlsx"] }],
        });
        if (typeof p !== "string") return;
        path = p;
      }
      await app.act("lexicon.load", { path });
      app.notify(tr("统计词库已加载"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const switchRow = (
    title: string,
    description: string,
    key: keyof typeof s,
  ) => (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p className="hint">{description}</p>
      </div>
      <Switch
        label={title}
        checked={s[key] as boolean}
        onChange={(v) => void set({ [key]: v })}
      />
    </div>
  );
  const title =
    section === "comfy"
      ? tr("设置与词库")
      : section === "appearance"
        ? tr("外观")
        : section === "editing"
          ? tr("编辑与窗口")
          : tr("统计词库与数据");
  return (
    <div className="standard-page">
      <PageHeading
        title={title}
        description={
          section === "comfy"
            ? tr("ComfyUI 的连接、后台启动、控制台与退出行为。")
            : section === "appearance"
              ? tr("默认采用 Linear 深色风格，颜色与背景设置即时预览。")
              : section === "editing"
                ? tr("输入习惯、名称复制和窗口行为。")
                : tr("Excel 统计词库独立于内置库，失败时保留当前有效数据。")
        }
        status={
          section === "comfy"
            ? tr("ComfyUI 配置")
            : error
              ? tr("设置未保存")
              : tr("设置已保存")
        }
        actions={
          <IconButton
            icon={ArrowLeft}
            label={tr("返回编辑工作台")}
            onClick={() =>
              app.open(
                app.data.project.State.IsNegative ? "negative" : "positive",
              )
            }
          />
        }
      />
      <div
        className={`settings-layout ${section === "comfy" ? "comfy-settings-layout" : ""}`}
      >
        <Panel className="settings-nav">
          <nav>
            {[
              ["appearance", tr("外观")],
              ["editing", tr("编辑与窗口")],
              ["data", tr("统计词库与数据")],
              ["comfy", "ComfyUI"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={section === key ? "active" : ""}
                onClick={() => {
                  setSection(key);
                  sessionStorage.setItem("settings-section", key);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </Panel>
        <div className="settings-content">
          <div hidden={section !== "comfy"}>
            <ComfySettings />
          </div>
          {section === "appearance" && (
            <>
              <Panel title={tr("界面语言")} className="theme-mode-panel">
                <Field label={tr("界面语言")}>
                  <select
                    className="font-select"
                    value={s.Language || "system"}
                    onChange={(e) => void set({ Language: e.target.value as LanguagePreference })}
                  >
                    <option value="system">{tr("跟随系统")}</option>
                    <option value="zh-CN" lang="zh-CN">简体中文</option>
                    <option value="en" lang="en">English</option>
                  </select>
                </Field>
              </Panel>
              <Panel title={tr("外观模式与字体")} className="theme-mode-panel">
                <div style={{ marginBottom: 16 }}>
                  <strong style={{ display: "block", marginBottom: 6 }}>{tr("外观模式")}</strong>
                  <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>{tr("选择应用程序的主题表现形式，支持 Light Mode、Dark Mode 与跟随系统。")}</p>
                  <Segments
                    label={tr("外观模式")}
                    value={s.ThemeMode || "dark"}
                    items={[
                      { label: "Light Mode", value: "light" },
                      { label: "Dark Mode", value: "dark" },
                      { label: "System", value: "system" },
                    ]}
                    onChange={(val) =>
                      void set({
                        ThemeMode: val as "light" | "dark" | "system",
                      })
                    }
                  />
                </div>
                <div>
                  <strong style={{ display: "block", marginBottom: 6 }}>{tr("程序字体")}</strong>
                  <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>{tr("从系统已安装字体列表中选择程序显示字体，留空或选择默认则恢复 Microsoft YaHei UI。")}</p>
                  <select
                    className="font-select"
                    style={{
                      width: "100%",
                      maxWidth: 360,
                      height: 32,
                      padding: "0 10px",
                      borderRadius: 6,
                      background: "var(--panel)",
                      color: "var(--text)",
                      border: "1px solid var(--border)",
                    }}
                    value={s.FontFamily || ""}
                    onChange={(e) => void set({ FontFamily: e.target.value })}
                  >
                    <option value="">{tr("系统默认 (Microsoft YaHei UI)")}</option>
                    {fonts.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </Panel>
              <Panel title={tr("主题颜色")} className="theme-panel">
                <p className="hint">{tr("主题色用于主要操作、焦点与选择竖线，八类视觉组保留独立底色。")}</p>
                <div className="theme-swatches">
                  <button
                    aria-label={tr("Linear 默认紫色")}
                    title={tr("Linear 默认紫色")}
                    className={
                      s.ThemeColor.toLowerCase() === "#7163d5" ? "chosen" : ""
                    }
                    style={{
                      background: lightAppearance ? "#5E4AC8" : "#7163D5",
                    }}
                    onClick={() => void set({ ThemeColor: "#7163D5" })}
                  />
                  {(lightAppearance
                    ? [
                        "#146B60",
                        "#245DB0",
                        "#A43B65",
                        "#795522",
                        "#526079",
                        "#583EA8",
                      ]
                    : colors
                  ).map((c) => (
                    <button
                      key={c}
                      aria-label={tr("主题色 {0}", c)}
                      title={c}
                      className={s.ThemeColor === c ? "chosen" : ""}
                      style={{ background: c }}
                      onClick={() => void set({ ThemeColor: c })}
                    />
                  ))}
                </div>
                <p className="hint mono">{s.ThemeColor}</p>
              </Panel>
              <Panel
                title={tr("背景图片")}
                className="background-panel"
                actions={
                  <>
                    <IconButton
                      icon={FolderOpen}
                      label={tr("选择背景图片")}
                      onClick={async () => {
                        try {
                          const p = await pick({
                            filters: [
                              {
                                name: tr("图片"),
                                extensions: [
                                  "png",
                                  "jpg",
                                  "jpeg",
                                  "webp",
                                  "bmp",
                                ],
                              },
                            ],
                          });
                          if (typeof p === "string")
                            await set({ BackgroundImage: p });
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    />
                    <IconButton
                      icon={Trash}
                      label={tr("移除背景图片")}
                      disabled={!s.BackgroundImage}
                      onClick={() => void set({ BackgroundImage: null })}
                    />
                  </>
                }
              >
                <div className="background-settings">
                  <div className="background-preview">
                    {s.BackgroundImage ? (
                      <AsyncImage
                        path={s.BackgroundImage}
                        alt={tr("工作台背景预览")}
                        style={{
                          opacity: s.BackgroundOpacity,
                          filter: `blur(${s.BackgroundBlur}px)`,
                        }}
                      />
                    ) : (
                      <div>
                        <ImageSquare size={32} />
                        <span>{tr("未设置背景图片")}</span>
                      </div>
                    )}
                  </div>
                  <Field
                    label={tr("不透明度 · {0}%", Math.round(s.BackgroundOpacity * 100))}
                  >
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={s.BackgroundOpacity}
                      onChange={(e) =>
                        void set({ BackgroundOpacity: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={tr("模糊 · {0} px", s.BackgroundBlur)}>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="1"
                      value={s.BackgroundBlur}
                      onChange={(e) =>
                        void set({ BackgroundBlur: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <p className="hint path">
                    {s.BackgroundImage ||
                      tr("背景仅用于工作台，不写入 PNG 项目卡。")}
                  </p>
                </div>
              </Panel>
            </>
          )}
          {section === "editing" && (
            <>
              <Panel title={tr("编辑行为")}>
                <div className="settings-body">
                  <Field
                    label={tr("权重调整步长")}
                    error={
                      Number(step) > 0 && Number(step) <= 100
                        ? ""
                        : tr("步长须大于 0 且不超过 100")
                    }
                  >
                    <input
                      type="number"
                      min="0.001"
                      max="100"
                      step="0.05"
                      value={step}
                      onChange={(e) => setStep(e.target.value)}
                      onBlur={() => {
                        if (Number(step) > 0 && Number(step) <= 100)
                          void set({ Step: Number(step) });
                      }}
                    />
                  </Field>
                  {switchRow(
                    tr("新建视觉组自动收起"),
                    tr("保留成员身份和顺序，展开后继续编辑。"),
                    "AutoCollapseNewGroups",
                  )}
                </div>
              </Panel>
              <Panel title={tr("LoRA 名称复制")}>
                <div className="settings-body">
                  {switchRow(
                    tr("包含目录前缀"),
                    tr("复制模型名称时保留相对目录。"),
                    "LoraCopyIncludeDirectory",
                  )}
                  {switchRow(
                    tr("包含文件扩展名"),
                    tr("复制模型名称时保留 .safetensors 等扩展名。"),
                    "LoraCopyIncludeExtension",
                  )}
                  <Field label={tr("复制示例")}>
                    <pre className="output-preview">{`${s.LoraCopyIncludeDirectory ? "characters/" : ""}silver_hair${s.LoraCopyIncludeExtension ? ".safetensors" : ""}`}</pre>
                  </Field>
                </div>
              </Panel>
              <Panel title={tr("窗口")}>
                <div className="settings-body">
                  {switchRow(
                    tr("窗口置顶"),
                    tr("窗口状态保存在本机设置中。"),
                    "Topmost",
                  )}
                  {switchRow(
                    tr("紧凑模式"),
                    tr("紧凑模式优先显示结构化词条。"),
                    "Compact",
                  )}
                  <p className="hint">{tr("窗口位置、大小和最大化状态会在重新启动后恢复。")}</p>
                </div>
              </Panel>
            </>
          )}
          {section === "data" && (
            <>
              <Panel
                title={tr("Excel 统计词库")}
                actions={
                  <>
                    <IconButton
                      icon={FolderOpen}
                      label={tr("选择统计 Excel")}
                      disabled={busy}
                      onClick={() => void loadExcel(true)}
                    />
                    <IconButton
                      icon={ArrowsClockwise}
                      label={tr("刷新统计词库 · F5")}
                      disabled={busy || !s.Excel}
                      onClick={() => void loadExcel()}
                    />
                  </>
                }
              >
                <div className="settings-body">
                  <Field label={tr("当前词库路径")}>
                    <input
                      readOnly
                      value={s.Excel || ""}
                      placeholder={tr("尚未选择统计 Excel")}
                    />
                  </Field>
                  <div className="lexicon-metrics">
                    <div>
                      <strong>
                        {app.data.lexicon.positive.toLocaleString()}
                      </strong>
                      <span>{tr("积极词条")}</span>
                    </div>
                    <div>
                      <strong>
                        {app.data.lexicon.negative.toLocaleString()}
                      </strong>
                      <span>{tr("消极词条")}</span>
                    </div>
                    <div>
                      <strong>
                        {(app.data.lexicon.size / 1024).toFixed(0)} KB
                      </strong>
                      <span>{tr("文件大小")}</span>
                    </div>
                  </div>
                  {switchRow(
                    tr("启动时自动读取词库"),
                    tr("读取失败时保留原始文件，当前有效词库继续使用。"),
                    "AutoLoad",
                  )}
                  {app.data.lexicon.changed && (
                    <Notice>{tr("统计 Excel 已变化，按 F5 重新读取。")}</Notice>
                  )}
                  <p className="hint">{tr("需要“积极提示词”和“消极提示词”工作表，包含提示词、中文翻译、使用次数列。")}</p>
                </div>
              </Panel>
              <Panel
                title={tr("数据存放与迁移")}
                actions={
                  <IconButton
                    icon={FolderOpen}
                    label={tr("选择数据迁移目标文件夹")}
                    onClick={async () => {
                      try {
                        const p = await pick({ directory: true });
                        if (typeof p === "string") setDest(p);
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  />
                }
              >
                <div className="settings-body">
                  <Field label={tr("当前数据目录")}>
                    <input readOnly value={app.data.dataDirectory} />
                  </Field>
                  <Field label={tr("迁移目标目录")}>
                    <input
                      value={dest}
                      onChange={(e) => setDest(e.target.value)}
                    />
                  </Field>
                  <Notice>{tr("项目卡、会话、收藏、词库、参数、模型资料和窗口设置分别保存。迁移会复制并验证文件，源目录保留。")}</Notice>
                  <div className="settings-data-actions">
                    <button
                      disabled={busy || dest === app.data.dataDirectory}
                      onClick={async () => {
                        if (
                          (await app.confirm({
                            title: tr("迁移本机数据目录？"),
                            body: (
                              <>
                                <p>{tr("将数据复制到：")}</p>
                                <p className="mono path">{dest}</p>
                                <p>{tr("目标不能与当前目录相互包含，不能覆盖已有文件。原目录会保留。")}</p>
                              </>
                            ),
                            confirm: tr("开始迁移"),
                          })) !== "confirm"
                        )
                          return;
                        setBusy(true);
                        try {
                          await app.act("data.migrate", { path: dest });
                          app.notify(tr("数据目录已迁移"));
                        } catch (e) {
                          setError(String(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >{tr("迁移到此目录")}</button>
                  </div>
                </div>
              </Panel>
              {app.data.errors.length > 0 && (
                <Panel title={tr("启动时保留的读取错误")}>
                  <div className="settings-body">
                    {app.data.errors.map((e, i) => (
                      <Notice error key={i}>
                        {e}
                      </Notice>
                    ))}
                  </div>
                </Panel>
              )}
            </>
          )}
          {error && <Notice error>{error}</Notice>}
        </div>
      </div>
    </div>
  );
}
export function RecentPage() {
  const app = useApp();
  const [items, setItems] = useState<{ path: string; exists: boolean }[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    void rpc<typeof items>("project.recent")
      .then(setItems)
      .catch((e) => app.reportError(String(e)));
  }, [app.data.settings.RecentProjects]);
  const visible = items.filter((i) =>
    i.path.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="standard-page">
      <PageHeading
        title={tr("历史项目")}
        description={tr("最近打开的 20 个项目，跨启动保留。失效文件会保留记录并置灰显示。")}
        status={tr("{0} 个最近项目", items.length)}
        actions={
          <IconButton
            icon={FolderOpen}
            label={tr("打开其他项目")}
            onClick={() => void app.openProject()}
          />
        }
      />
      <Panel title={tr("最近打开")} className="recent-panel">
        <div className="recent-search">
          <input
            aria-label={tr("搜索历史项目")}
            data-workspace-search
            placeholder={tr("搜索名称或文件路径…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="recent-list">
          {visible.map((item, i) => (
            <button
              className={`recent-row ${!item.exists ? "missing" : ""}`}
              key={item.path}
              disabled={!item.exists}
              onClick={() => void app.openProject(item.path)}
            >
              <ClockCounterClockwise size={20} />
              <span>
                <strong>{item.path.split(/[\\/]/).at(-1)}</strong>
                <small title={item.path}>{item.path}</small>
              </span>
              <span>
                {item.exists
                  ? i === 0
                    ? tr("最近打开")
                    : tr("PNG 提示词卡")
                  : tr("文件不可用")}
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!visible.length && (
            <Empty
              title={query ? tr("没有匹配的项目") : tr("还没有历史项目")}
              description={tr("打开或保存提示词卡后，会在此显示。")}
              action={
                <button onClick={() => void app.openProject()}>
                  <FolderOpen size={16} />{tr("打开项目")}</button>
              }
            />
          )}
        </div>
      </Panel>
    </div>
  );
}
