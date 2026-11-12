import { setLocale, tr, trDiagnostic } from "./i18n";
import { useMovingIndicator } from "./editor-motion";
import { useTabSort } from "./tab-sort";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  PlusCircle,
  MinusCircle,
  SlidersHorizontal,
  Cube,
  Books,
  Star,
  Stack,
  ClockCounterClockwise,
  FolderOpen,
  Gear,
  CaretDown,
  SidebarSimple,
  Minus,
  Square,
  X,
  Plus,
  TextAlignLeft,
  CheckCircle,
  TerminalWindow,
} from "@phosphor-icons/react";
import { ComfyProcessProvider, ComfyConsolePage, ComfyServiceCard, prepareComfyExit } from "./comfy-process";
import { ComfyWebPage, ComfyWebLauncher } from "./comfy-web";
import { promptInsertionStart } from "./prompt-insertion";
import { rpc, pick, openDataFolder } from "./api";
import { AppContext, type ConfirmOptions } from "./context";
import type { AppData } from "./types";
import {
  IconButton,
  Toast,
  Modal,
  Menu,
  Empty,
  AsyncImage,
  type MenuItem,
} from "./ui";
import { SaveCard, ImportImage } from "./file-dialogs";
import { ProbePage } from "./comfy-probe";
import { GenerationHistoryPage } from "./comfy-history";
import { EditorPage } from "./editor-page";
import {
  ComfyLinkProvider,
  GenerationProgress,
  ResultFilmstrip,
} from "./comfy-link";
import { GenerationPage, ModelsPage } from "./generation-pages";
import { BuiltinPage, FavoritesPage, LoraPage } from "./library-pages";
import { SnapshotsPage, SettingsPage, RecentPage } from "./workspace-pages";
const pages: Record<string, { title: string; icon: any }> = {
  positive: { title: "积极提示词", icon: PlusCircle },
  negative: { title: "消极提示词", icon: MinusCircle },
  generation: { title: "生成参数", icon: SlidersHorizontal },
  models: { title: "模型控制", icon: Cube },
  builtin: { title: "内置提示词库", icon: Books },
  favorites: { title: "收藏与片段", icon: Star },
  lora: { title: "LoRA 模型库", icon: Stack },
  snapshots: { title: "快照与对比", icon: ClockCounterClockwise },
  runs: { title: "生成记录", icon: ClockCounterClockwise },
  probe: { title: "效果探针", icon: SlidersHorizontal },
  recent: { title: "历史项目", icon: FolderOpen },
  settings: { title: "设置与词库", icon: Gear },
  console: { title: "ComfyUI 控制台", icon: TerminalWindow },
  comfy: { title: "ComfyUI 网页", icon: Cube },
};
export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const dataRef = useRef<AppData | null>(null);
  const [page, setPage] = useState("positive");
  const pageRef = useRef(page);
  pageRef.current = page;
  const sidebarMotionRef = useRef<HTMLElement>(null);
  const tabsMotionRef = useRef<HTMLDivElement>(null);
  useMovingIndicator(sidebarMotionRef, ".nav-item.selected", page);
  useMovingIndicator(tabsMotionRef, ".tab.active", page);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [operationError, setOperationError] = useState("");
  const [modal, setModal] = useState<ReactNode>(null);
  const [confirmation, setConfirmation] = useState<{
    options: ConfirmOptions;
    resolve: (r: "confirm" | "cancel" | "third") => void;
  } | null>(null);
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
    width?: number;
    source?: "project";
  } | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [tabs, setTabs] = useState<string[]>(() => {
    try {
      return [
        ...new Set([
          "positive",
          "negative",
          ...JSON.parse(localStorage.getItem("tabs") || "[]").filter(
            (s: string) => pages[s],
          ),
        ]),
      ];
    } catch {
      return ["positive", "negative"];
    }
  });
  const [pinned, setPinned] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem("pinned-tabs") || "[]"),
  );
  const displayedTabs = useTabSort(tabsMotionRef, tabs, setTabs, !!data);
  const closedTabs = useRef<string[]>([]);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const themeMode = data?.settings?.ThemeMode || "dark";
  const isLight =
    themeMode === "light" || (themeMode === "system" && !systemDark);
  const activeTheme = isLight ? "light" : "dark";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    const font = data?.settings?.FontFamily?.trim();
    if (font) {
      document.documentElement.style.setProperty(
        "--app-font",
        `"${font}", "Microsoft YaHei UI", sans-serif`,
      );
    } else {
      document.documentElement.style.removeProperty("--app-font");
    }
  }, [data?.settings?.FontFamily]);
  const flush = useRef<() => Promise<void>>(async () => {});
  const draftGuards = useRef(new Map<string, () => Promise<boolean>>());
  const draftFlushers = useRef(new Map<string, () => Promise<void>>());
  const draftRepairs = useRef(new Map<string, () => Promise<void>>());
  const compactState = useRef<boolean | null>(null);
  const normalWindow = useRef<{
    width: number;
    height: number;
    maximized: boolean;
  } | null>(null);
  const flushAll = useCallback(async () => {
    await flush.current();
    for (const commit of draftFlushers.current.values()) await commit();
  }, []);
  const mounted = useRef(true);
  const reportError = useCallback(
    (message: string) => setOperationError(message),
    [],
  );
  const notify = useCallback((s: string) => setToast(s), []);
  const update = useCallback((s: AppData) => {
    setLocale(s.settings.Language);
    dataRef.current = s;
    if (mounted.current) setData(s);
  }, []);
  const refresh = useCallback(async () => update(await rpc("state.get")), []);
  const act = useCallback(
    async <T,>(method: string, payload: unknown = {}): Promise<T> => {
      if (
        ![
          "editor.text",
          "editor.view",
          "editor.composition",
          "generation.invalid",
        ].includes(method)
      )
        await flush.current();
      let result: T;
      if (["editor.insert", "favorites.insert", "builtin.apply", "lora.triggers.insert"].includes(method) && dataRef.current) {
        const p = payload as { start?: number; negative?: boolean };
        if (p.start == null) payload = { ...p, start: promptInsertionStart(dataRef.current.project.State, p.negative) };
      }
      try {
        result = await rpc<T>(method, payload);
      } catch (e) {
        if (method.startsWith("bridge.")) await refresh().catch(() => {});
        if (method !== "project.save") reportError(String(e));
        throw e;
      }
      if (
        result &&
        typeof result === "object" &&
        "project" in result &&
        "settings" in result
      )
        update(result as unknown as AppData);
      else if (method.startsWith("bridge.")) await refresh();
      return result;
    },
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<"confirm" | "cancel" | "third">((resolve) =>
        setConfirmation({ options, resolve }),
      ),
    [],
  );
  const open = useCallback((id: string) => {
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPage(id);
    if (["positive", "negative"].includes(id))
      void act("editor.workspace", { negative: id === "negative" }).catch((e) =>
        reportError(String(e)),
      );
  }, []);
  const save = useCallback(async (as = false) => {
    let saveAs = as;
    while (true) {
      await flushAll();
      const d = dataRef.current!;
      if (saveAs || !d.projectPath) {
        return new Promise<void>((resolve, reject) =>
          setModal(
            <SaveCard
              saveAs={saveAs}
              onClose={() => {
                setModal(null);
                reject(new DOMException(tr("已取消"), "AbortError"));
              }}
              onSaved={() => {
                setModal(null);
                setOperationError("");
                notify(tr("提示词卡已保存"));
                resolve();
              }}
            />,
          ),
        );
      }
      try {
        await act("project.save", {});
        setOperationError("");
        notify(tr("提示词卡已保存"));
        return;
      } catch (e) {
        const action = await new Promise<"retry" | "saveAs" | "cancel">(
          (resolve) => {
            const choose = (value: "retry" | "saveAs" | "cancel") => {
              setModal(null);
              resolve(value);
            };
            setModal(
              <Modal
                title={tr("保存失败")}
                onClose={() => choose("cancel")}
                footer={
                  <>
                    <button onClick={() => choose("cancel")}>{tr("返回编辑")}</button>
                    <span className="spacer" />
                    <button onClick={() => choose("saveAs")}>{tr("另存到其他位置")}</button>
                    <button className="primary" onClick={() => choose("retry")}>{tr("重试")}</button>
                  </>
                }
              >
                <p role="alert">{tr("保存失败。你的修改仍保留在编辑器中。")}</p>
                <p className="hint">{tr("完成保存后才会继续刚才的操作。")}</p>
                <details className="error-details">
                  <summary>{tr("技术详情")}</summary>
                  <pre>{String(e)}</pre>
                </details>
              </Modal>,
            );
          },
        );
        if (action === "cancel") throw new DOMException(tr("已取消"), "AbortError");
        saveAs = action === "saveAs";
      }
    }
  }, []);
  const guard = useCallback(async () => {
    await flushAll();
    for (const check of draftGuards.current.values())
      if (!(await check())) return false;
    if (!dataRef.current?.dirty) return true;
    const answer = await confirm({
      title: tr("保存对项目的修改？"),
      body: (
        <p>{tr("提示词卡有未保存修改（包括提示词、快照和生成参数）。请先保存提示词卡，或选择不保存继续。")}</p>
      ),
      confirm: tr("保存"),
      cancel: tr("取消"),
      third: tr("不保存"),
    });
    if (answer === "cancel") return false;
    if (answer === "confirm") {
      try {
        await save();
      } catch {
        return false;
      }
    }
    return true;
  }, []);
  const newProject = useCallback(async () => {
    try {
      if (!(await guard())) return;
      await act("project.new");
      open("positive");
    } catch (e) {
      reportError(String(e));
    }
  }, []);
  const openProject = useCallback(async (path?: string) => {
    try {
      if (!path) {
        const p = await pick({
          filters: [{ name: tr("提示词项目"), extensions: ["png", "json"] }],
        });
        if (typeof p !== "string") return;
        path = p;
      }
      if (!(await guard())) return;
      await act("project.open", { path });
      open(dataRef.current?.project.State.IsNegative ? "negative" : "positive");
    } catch (e) {
      reportError(String(e));
    }
  }, []);
  const importImage = useCallback(async (path?: string) => {
    try {
      if (!path) {
        const p = await pick({
          filters: [{ name: tr("PNG 图片"), extensions: ["png"] }],
        });
        if (typeof p !== "string") return;
        path = p;
      }
      const info = await act<any>("image.inspect", { path });
      setModal(
        <ImportImage path={path} info={info} onClose={() => setModal(null)} />,
      );
    } catch (e) {
      reportError(String(e));
    }
  }, []);
  const closeTab = useCallback(
    async (id: string) => {
      if (["positive", "negative"].includes(id) || pinned.includes(id)) return;
      try {
        await draftFlushers.current.get(id)?.();
      } catch (e) {
        reportError(String(e));
        return;
      }
      if (
        draftGuards.current.has(id) &&
        !(await draftGuards.current.get(id)!())
      )
        return;
      closedTabs.current.push(id);
      setTabs((prev) => prev.filter((s) => s !== id));
      if (page === id) open("positive");
    },
    [pinned, page],
  );
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const listeners: Promise<() => void>[] = [];
    (async () => {
      try {
        if (isTauri()) {
          const { listen } = await import("@tauri-apps/api/event");
          if (disposed) return;
          listeners.push(
            listen<{ id: string }>("bridge-prepare", async (e) => {
              let error: string | null = null;
              try {
                await flushAll();
              } catch (e) {
                error = String(e);
              }
              await rpc("bridge.ready", { id: e.payload.id, error });
            }),
          );
          listeners.push(
            listen("bridge-state-changed", () => {
              void refresh();
            }),
          );
          await Promise.all(listeners);
          await rpc("ui.ready");
        }
        if (!disposed) await refresh();
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    })();
    return () => {
      mounted.current = false;
      disposed = true;
      for (const p of listeners) void p.then((fn) => fn());
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("tabs", JSON.stringify(tabs));
  }, [tabs]);
  useEffect(() => {
    localStorage.setItem("pinned-tabs", JSON.stringify(pinned));
  }, [pinned]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!isTauri()) return;
    const w = getCurrentWindow();
    let disposed = false;
    let unlisten: () => void = () => {};
    let closing = false;
    void w
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (closing) return;
        closing = true;
        try {
          if (await guard() && await prepareComfyExit(confirm)) {
            await act("session.flush");
            await w.destroy();
          }
        } catch (e) {
          reportError(tr("退出未完成：{0}", e));
        } finally {
          closing = false;
        }
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    const drop = w.onDragDropEvent((e) => {
      if (e.payload.type === "drop") {
        const paths = e.payload.paths;
        const point = e.payload.position;
        const target = document
          .elementFromPoint(
            point.x / devicePixelRatio,
            point.y / devicePixelRatio,
          )
          ?.closest("[data-native-image-drop]");
        if (target) {
          target.dispatchEvent(
            new CustomEvent("native-image-drop", { detail: paths }),
          );
          return;
        }
        if (document.querySelector("[role=dialog]")) {
          notify(tr("请将图片拖入弹窗中的图片区域"));
          return;
        }
        if (paths.length === 1 && /\.png$/i.test(paths[0]))
          void importImage(paths[0]);
        else notify(tr("请拖入一张 PNG 提示词卡或生成图片"));
      }
    });
    return () => {
      disposed = true;
      unlisten();
      void drop.then((u) => u());
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || document.querySelector('[role="dialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const visible = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest('[hidden]');
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault(); e.stopPropagation();
        const input = Array.from(document.querySelectorAll<HTMLInputElement>('.page-host input[data-workspace-search]')).find(el => visible(el));
        input?.focus(); input?.select(); return;
      }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebar(v => !v); return; }
      if (mod && e.key.toLowerCase() === 'd' && ['generation','models'].includes(page)) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('.page-host:not([hidden]) [data-refresh-shortcut]')?.click(); return;
      }
      if (!mod && !e.altKey && !e.shiftKey && e.key === 'Tab' && ['positive','negative'].includes(page) && !e.defaultPrevented) {
        e.preventDefault();
        const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.terms-heading [role="tab"]'));
        tabs.find(el => el.getAttribute('aria-selected') !== 'true')?.click(); return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save(e.shiftKey).catch((e) => {
          if (e.name !== "AbortError") reportError(String(e));
        });
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newProject();
      }
      if (e.key === "F5") {
        e.preventDefault();
        void act("lexicon.load")
          .then(() => notify(tr("词库已刷新")))
          .catch((e) => reportError(String(e)));
      }
      if (mod && e.key === "Tab") {
        e.preventDefault();
        const at = tabs.indexOf(page);
        open(tabs[(at + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]);
      }
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        open(page === "positive" ? "negative" : "positive");
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const id = closedTabs.current.pop();
        if (id) open(id);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [tabs, page, pinned]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten = () => {};
    void import("@tauri-apps/api/event").then(({ listen }) => listen("prompt-editor-toggle-prompts", () => {
      if (!document.querySelector('[role="dialog"]')) {
        open(pageRef.current === "positive" ? "negative" : "positive");
        void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) => getCurrentWebview().setFocus()).catch((e) => reportError(String(e)));
      }
    })).then((remove) => { if (disposed) remove(); else unlisten = remove; });
    return () => { disposed = true; unlisten(); };
  }, []);
  useEffect(() => {
    if (isTauri() && data)
      void getCurrentWindow()
        .setAlwaysOnTop(data.settings.Topmost)
        .catch((e) => reportError(String(e)));
  }, [data?.settings.Topmost]);
  useEffect(() => {
    if (!isTauri() || !data) return;
    const compact = data.settings.Compact,
      previous = compactState.current;
    compactState.current = compact;
    if (previous === compact || (previous === null && !compact)) return;
    const w = getCurrentWindow();
    void (async () => {
      if (compact) {
        if (previous === false) {
          const size = (await w.innerSize()).toLogical(await w.scaleFactor());
          normalWindow.current = {
            width: Math.round(size.width),
            height: Math.round(size.height),
            maximized: await w.isMaximized(),
          };
          await act("settings.set", {
            value: {
              ...dataRef.current!.settings,
              NormalWidth: Math.round(size.width),
              NormalHeight: Math.round(size.height),
              Maximized: normalWindow.current.maximized,
            },
          });
        } else
          normalWindow.current = {
            width: data.settings.NormalWidth,
            height: data.settings.NormalHeight,
            maximized: data.settings.Maximized,
          };
        if (await w.isMaximized()) await w.unmaximize();
        await w.setSize(new LogicalSize(880, 650));
      } else {
        const size = normalWindow.current || {
          width: data.settings.NormalWidth,
          height: data.settings.NormalHeight,
          maximized: data.settings.Maximized,
        };
        await w.setSize(new LogicalSize(size.width, size.height));
        if (size.maximized) await w.maximize();
      }
    })().catch((e) => reportError(String(e)));
  }, [data?.settings.Compact]);
  if (!data)
    return (
      <div className="startup">
        <img src="/icon.png" width="48" />
        <h1>Prompt Editor</h1>
        <p>{error || tr("正在读取本地工作空间…")}</p>
        {error && (
          <button
            onClick={() => {
              setError("");
              void refresh().catch((e) => setError(String(e)));
            }}
          >{tr("重新连接")}</button>
        )}
      </div>
    );
  const projectName =
    data.projectPath
      ?.split(/[\\/]/)
      .at(-1)
      ?.replace(/(?:\.prompt-card)?\.png$/i, "") || tr("未命名项目");
  const projectMenu: MenuItem[] = [
    { label: tr("新建项目"), shortcut: "Ctrl+N", action: newProject },
    { label: tr("打开项目…"), shortcut: "Ctrl+O", action: openProject },
    { label: tr("从图片导入…"), action: importImage },
    { label: tr("历史项目"), action: () => open("recent") },
    { separator: true, label: "" },
    {
      label: tr("保存提示词卡"),
      shortcut: "Ctrl+S",
      action: () =>
        save().catch((e) => {
          if (e.name !== "AbortError") reportError(String(e));
        }),
    },
    {
      label: tr("另存为…"),
      shortcut: "Ctrl+Shift+S",
      action: () =>
        save(true).catch((e) => {
          if (e.name !== "AbortError") reportError(String(e));
        }),
    },
  ];
  const context = {
    data,
    act,
    refresh,
    notify,
    reportError,
    confirm,
    open,
    page,
    modal: setModal,
    flush,
    draftGuards,
    draftFlushers,
    draftRepairs,
    save,
    newProject,
    openProject,
    importImage,
  };
  const renderPage = (id: string) => {
    switch (id) {
      case "probe":
        return <ProbePage key={sessionStorage.getItem("probe-target")||"probe"}/>;
      case "runs":
        return <GenerationHistoryPage />;
      case "generation":
        return <GenerationPage />;
      case "models":
        return <ModelsPage />;
      case "builtin":
        return <BuiltinPage />;
      case "favorites":
        return <FavoritesPage />;
      case "lora":
        return <LoraPage />;
      case "snapshots":
        return <SnapshotsPage />;
      case "recent":
        return <RecentPage />;
      case "settings":
        return <SettingsPage />;
      case "console":
        return <ComfyConsolePage />;
      case "comfy":
        return <ComfyWebPage />;
      default:
        return null;
    }
  };
  const navigation = (id: string, title?: string) => {
    const Icon = id === "positive" ? TextAlignLeft : pages[id].icon;
    return (
      <button
        key={id}
        className={`nav-item ${page === id || (id === "positive" && page === "negative") ? "selected" : ""}`}
        onClick={() => open(id)}
      >
        <Icon size={16} />
        <span>{title || tr(pages[id].title)}</span>
        {id === "snapshots" && <small>{data.project.Snapshots.length}</small>}
      </button>
    );
  };
  return (
    <AppContext.Provider value={context}>
      <ComfyLinkProvider>
      <ComfyProcessProvider>
      <div
        className={`app ${!sidebar ? "sidebar-collapsed" : ""} ${data.settings.Compact ? "compact" : ""}`}
        data-theme={activeTheme}
        data-page={page}
        style={
          {
            "--action": activeTheme === "light" && data.settings.ThemeColor.toLowerCase() === "#7163d5" ? "#5E4AC8" : data.settings.ThemeColor,
            "--app-font": data.settings.FontFamily
              ? `"${data.settings.FontFamily}", "Microsoft YaHei UI", sans-serif`
              : undefined,
          } as React.CSSProperties
        }
      >
        {sidebar && (
          <aside ref={sidebarMotionRef} className="sidebar">
            <div className="brand">
              <img src="/icon.png" width="24" height="24" />
              <strong>Prompt Editor</strong>
            </div>
            <button
              className="project-button"
              title={projectName}
              aria-haspopup="menu"
              aria-expanded={menu?.source === "project"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu((previous) => previous?.source === "project" ? null : {
                  items: projectMenu,
                  source: "project",
                  x: rect.left,
                  y: rect.bottom + 4,
                  width: rect.width,
                });
              }}
            >
              <FolderOpen size={16} />
              <span>
                <strong>{projectName}</strong>
                <small>{tr("本地项目 · PNG 提示词卡")}</small>
              </span>
              <CaretDown size={14} />
            </button>
            <nav aria-label={tr("主导航")}>
              <span className="nav-label">{tr("工作区")}</span>
              {navigation("positive", tr("提示词编辑"))}
              {navigation("generation")}
              {navigation("models")}
              {navigation("runs")}
              {navigation("console")}
              <ComfyWebLauncher />
              <span className="nav-label">{tr("资源库")}</span>
              {navigation("builtin")}
              {navigation("favorites")}
              {navigation("lora")}
              <span className="nav-label">{tr("项目")}</span>
              {navigation("snapshots")}
              {navigation("recent")}
            </nav>
            <div className="sidebar-bottom">
              <ComfyServiceCard />
              {navigation("settings")}
              <span className="local-label">{tr("本地工作空间")}</span>
            </div>
          </aside>
        )}
        <div className="workbench">
          {data.settings.BackgroundImage && (
            <div className="workbench-background" aria-hidden="true">
              <AsyncImage
                path={data.settings.BackgroundImage}
                style={{
                  opacity: data.settings.BackgroundOpacity,
                  filter: `blur(${data.settings.BackgroundBlur}px)`,
                }}
              />
            </div>
          )}
          <header
            className="chrome"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (isTauri()) void getCurrentWindow().toggleMaximize();
            }}
          >
            <span data-tauri-drag-region>{tr("提示词编辑器 /") + " "}{projectName}
              {data.dirty ? " *" : ""}
            </span>
            <div className="inline-actions">
              <IconButton
                icon={SidebarSimple}
                label={tr("切换导航栏")}
                onClick={() => setSidebar(!sidebar)}
              />
              <IconButton
                icon={Minus}
                label={tr("最小化窗口")}
                onClick={() => {
                  if (isTauri()) void getCurrentWindow().minimize();
                }}
              />
              <IconButton
                icon={Square}
                label={tr("最大化或还原窗口")}
                onClick={() => {
                  if (isTauri()) void getCurrentWindow().toggleMaximize();
                }}
              />
              <IconButton
                icon={X}
                label={tr("关闭窗口")}
                onClick={() => {
                  if (isTauri()) void getCurrentWindow().close();
                }}
              />
            </div>
          </header>
          <div
            ref={tabsMotionRef}
            className="tabs"
            role="tablist"
            aria-label={tr("工作页签")}
            onWheel={(e) => (e.currentTarget.scrollLeft += e.deltaY)}
          >
            {displayedTabs.map((id) => {
              const Icon = pages[id].icon;
              return (
                <div
                  key={id}
                  className={`tab ${page === id ? "active" : ""}`}
                  data-tab-id={id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        {
                          label: pinned.includes(id) ? tr("取消固定") : tr("固定页签"),
                          disabled: ["positive", "negative"].includes(id),
                          action: () =>
                            setPinned((prev) =>
                              prev.includes(id)
                                ? prev.filter((x) => x !== id)
                                : [...prev, id],
                            ),
                        },
                        {
                          label: tr("关闭页签"),
                          disabled:
                            ["positive", "negative"].includes(id) ||
                            pinned.includes(id),
                          action: () => closeTab(id),
                        },
                      ],
                    });
                  }}
                >
                  <button
                    role="tab"
                    aria-selected={page === id}
                    onClick={() => open(id)}
                  >
                    <Icon size={16} />
                    <span>{tr(pages[id].title)}</span>
                    {id === "positive" && (
                      <small>{data.project.State.Positive.Active.length}</small>
                    )}
                    {id === "negative" && (
                      <small>{data.project.State.Negative.Active.length}</small>
                    )}
                  </button>
                  {!["positive", "negative"].includes(id) &&
                    !pinned.includes(id) && (
                      <IconButton
                        icon={X}
                        label={tr("关闭{0}页签", tr(pages[id].title))}
                        onClick={() => closeTab(id)}
                      />
                    )}
                </div>
              );
            })}
            <IconButton
              icon={Plus}
              label={tr("打开功能页")}
              onClick={(e) =>
                setMenu({
                  x: e.currentTarget.getBoundingClientRect().left,
                  y: 86,
                  items: Object.entries(pages)
                    .filter(([k]) => !["positive", "negative"].includes(k))
                    .map(([id, p]) => ({
                      label: tr(p.title),
                      action: () => open(id),
                    })),
                })
              }
            />
            <span className="spacer" />
            <IconButton
              icon={CaretDown}
              label={tr("所有页签")}
              onClick={(e) =>
                setMenu({
                  x: e.currentTarget.getBoundingClientRect().right - 220,
                  y: 86,
                  items: tabs.map((id) => ({
                    label: tr(pages[id].title),
                    checked: page === id,
                    action: () => open(id),
                  })),
                })
              }
            />
          </div>
          <GenerationProgress />
          <main className="main">
            {data.sessionRestoreError && (
              <section
                className="recovery-banner"
                role="alert"
                aria-label={tr("工作区恢复失败")}
              >
                <div>
                  <strong>{tr("上次的工作区暂时无法读取。原文件已保留，尚未覆盖。")}</strong>
                  <p>{tr("请先备份原文件，再按恢复选项处理。")}</p>
                </div>
                <button
                  onClick={() =>
                    setModal(
                      <Modal
                        title={tr("工作区恢复选项")}
                        onClose={() => setModal(null)}
                        footer={
                          <>
                            <button
                              onClick={() =>
                                void openDataFolder(data.dataDirectory).catch(
                                  (e) => reportError(String(e)),
                                )
                              }
                            >{tr("打开数据文件夹")}</button>
                            <span className="spacer" />
                            <button onClick={() => setModal(null)}>{tr("返回编辑")}</button>
                          </>
                        }
                      >
                        <p>{tr("原 session.json 已受到写入保护，当前显示的是临时工作区。")}</p>
                        <ol>
                          <li>{tr("打开数据文件夹，将 session.json 复制到其他位置备份。")}</li>
                          <li>{tr("退出应用后修复原文件，或将其移到备份位置，再重新启动应用。")}</li>
                          <li>{tr("如已保存过 PNG 提示词卡，可通过“打开项目”恢复对应版本。")}</li>
                        </ol>
                        <p className="hint">{tr("在完成恢复前，请将新修改另存为提示词卡。")}</p>
                        <details className="error-details">
                          <summary>{tr("技术详情与文件位置")}</summary>
                          <pre>
                            {data.dataDirectory}
                            {"/session.json\n"}
                            {data.sessionRestoreError}
                          </pre>
                        </details>
                      </Modal>,
                    )
                  }
                >{tr("查看恢复选项")}</button>
                <button
                  onClick={() =>
                    void openDataFolder(data.dataDirectory).catch((e) =>
                      reportError(String(e)),
                    )
                  }
                >{tr("打开数据文件夹")}</button>
              </section>
            )}
            <div
              className="page-host"
              hidden={!["positive", "negative"].includes(page)}
            >
              <EditorPage />
            </div>
            {tabs
              .filter((id) => !["positive", "negative"].includes(id))
              .map((id) => (
                <div className="page-host" hidden={page !== id} key={id}>
                  {renderPage(id)}
                </div>
              ))}
          </main>
          {!["runs", "probe", "console", "comfy", "settings"].includes(page) && <ResultFilmstrip />}
          <footer
            className="statusbar"
            data-narrow-hint={["console", "settings"].includes(page) ? tr("Ctrl + Tab 切换页签") : tr("原文与词条上下排列 · 中间分隔条可拖动")}
            data-compact-hint={tr("解析完成 · 复制全部有效项")}
          >
            <CheckCircle size={12} />
            <span>
              {data.sessionRestoreError
                ? tr("工作区原文件已保护")
                : tr("工作区自动保存")}
            </span>
            <span className="card-save-status">
              {data.dirty ? tr("提示词卡有未保存修改") : tr("提示词卡无未保存修改")}
            </span>
            <span
              className="lexicon-status"
              title={data.lexicon.path || tr("尚未加载 Excel 词库")}
            >
              {data.lexicon.path?.split(/[\\/]/).at(-1) || tr("未加载统计词库")}{" " + tr("· F5 刷新词库")}{data.lexicon.changed ? tr(" · 文件已变化") : ""}
            </span>
            <span className="spacer" />
            <span>{tr("Ctrl + Tab 切换页签")}</span>
          </footer>
        </div>
      </div>
      {modal}
      {confirmation && (
        <Modal
          className="application-confirmation"
          title={confirmation.options.title}
          width={560}
          onClose={() => {
            confirmation.resolve("cancel");
            setConfirmation(null);
          }}
          footer={
            <>
              <span className="spacer" />
              {confirmation.options.third && (
                <button
                  onClick={() => {
                    confirmation.resolve("third");
                    setConfirmation(null);
                  }}
                >
                  {confirmation.options.third}
                </button>
              )}
              <button
                data-default-focus
                autoFocus
                onClick={() => {
                  confirmation.resolve("cancel");
                  setConfirmation(null);
                }}
              >
                {confirmation.options.cancel || tr("取消")}
              </button>
              <button
                className={
                  confirmation.options.danger ? "danger-button" : "primary"
                }
                onClick={() => {
                  confirmation.resolve("confirm");
                  setConfirmation(null);
                }}
              >
                {confirmation.options.confirm || tr("确认")}
              </button>
            </>
          }
        >
          {confirmation.options.body}
        </Modal>
      )}
      {menu && <Menu {...menu} onClose={() => setMenu(null)} />}{" "}
      {operationError && (
        <div className="operation-error" role="alert">
          <div>
            <strong>{tr("操作未完成，请查看错误后重试。")}</strong>
            <details className="error-details">
              <summary>{tr("技术详情")}</summary>
              <pre>{trDiagnostic(operationError)}</pre>
            </details>
          </div>
          <IconButton
            icon={X}
            label={tr("关闭错误通知")}
            onClick={() => setOperationError("")}
          />
        </div>
      )}
      {toast && (
        <Toast onClose={() => setToast("")}>{toast}</Toast>
      )}
      </ComfyProcessProvider>
      </ComfyLinkProvider>
    </AppContext.Provider>
  );
}
