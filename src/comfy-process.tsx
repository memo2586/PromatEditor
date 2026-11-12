import { tr, trDiagnostic } from "./i18n";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowsClockwise,
  Broom,
  CaretRight,
  Copy,
  FolderOpen,
  Gear,
  Play,
  SpinnerGap,
  Stop,
  TerminalWindow,
  TextAlignLeft,
} from "@phosphor-icons/react";
import { rpc, openExternal, pick } from "./api";
import { useApp, type ConfirmOptions } from "./context";
import { ComfyConnectionCard, useLink } from "./comfy-link";
import { IconButton, Notice, Switch } from "./ui";
import "./comfy-process.css";

export type ProcessConfig = {
  directory: string;
  python: string;
  extraArgs: string;
  port: number;
  lan: boolean;
  openConsole: boolean;
  webOpenMode: "tab" | "browser";
  webUrl: string;
  openWebOnStart: boolean;
  autoScroll: boolean;
  wrap: boolean;
  logLimit: number;
  autoStart: boolean;
  exitPolicy: "ask" | "keep" | "stop";
};
type ProcessState = {
  status: string;
  owned: boolean;
  message: string;
  pid?: number;
  elapsed: number;
  port: number;
  canForce: boolean;
  revision?: string;
  lines?: string[];
};
type ConfigResult = { config: ProcessConfig; url: string; error?: string };
const labels: Record<string, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  failed: "启动失败",
  external: "外部运行",
};
const ProcessContext = createContext<{
  state: ProcessState;
  config: ProcessConfig | null;
  url: string;
  error: string;
  busy: boolean;
  load: () => Promise<void>;
  poll: () => Promise<void>;
  start: () => Promise<void>;
  stop: (force?: boolean) => Promise<void>;
  preference: (p: Partial<ProcessConfig>) => Promise<void>;
  save: (c: ProcessConfig, url: string) => Promise<void>;
  openWeb: () => Promise<void>;
}>(null!);
export const useComfyProcess = () => useContext(ProcessContext);
export function openComfySettings(app: ReturnType<typeof useApp>) {
  sessionStorage.setItem("settings-section", "comfy");
  app.open("settings");
  window.dispatchEvent(new Event("settings-section"));
}

export function ComfyProcessProvider({ children }: { children: ReactNode }) {
  const app = useApp(),
    link = useLink();
  const [state, setState] = useState<ProcessState>({
    status: "stopped",
    owned: false,
    message: "",
    elapsed: 0,
    port: 8188,
    canForce: false,
    lines: [],
  });
  const [config, setConfig] = useState<ProcessConfig | null>(null);
  const [url, setUrl] = useState(app.data.bridge.comfyUrl);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingWeb = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;
  async function openWeb() {
    const current = configRef.current || (await rpc<ConfigResult>("process.config")).config;
    if (current.webOpenMode === "browser") await openExternal(current.webUrl?.trim() || app.data.bridge.comfyUrl);
    else app.open("comfy");
  }
  useEffect(() => {
    if (pendingWeb.current && ["running", "external"].includes(state.status)) {
      pendingWeb.current = false;
      void openWeb().catch((e) => app.reportError(String(e)));
    } else if (["failed", "stopped"].includes(state.status)) pendingWeb.current = false;
  }, [state.status]);
  const gate = useRef(false),
    alive = useRef(true),
    revision = useRef("");
  const page = useRef(app.page);
  page.current = app.page;
  const update = (v: ProcessState) => {
    if (!alive.current) return;
    if (v.revision != null) revision.current = v.revision;
    setState((s) => ({ ...s, ...v, lines: v.lines ?? s.lines }));
  };
  async function load() {
    const result = await rpc<ConfigResult>("process.config");
    if (!alive.current) return;
    setConfig(result.config);
    setUrl(result.url);
    if (result.error) setError(result.error);
  }
  async function poll() {
    update(
      await rpc<ProcessState>("process.poll", {
        revision: revision.current,
        logs: page.current === "console",
      }),
    );
  }
  async function start() {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      update(await rpc("process.start"));
      pendingWeb.current = !!config?.openWebOnStart;
      if (config?.openConsole) app.open("console");
    } catch (e) {
      setError(String(e));
      app.open("console");
      await poll();
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function stop(force = false) {
    if (gate.current || !state.owned) return;
    const q = link.status.live.queue;
    const active = q?.running.length || 0,
      pending = q?.pending.length || 0;
    const answer = await app.confirm({
      title: force ? tr("强制结束 ComfyUI？") : tr("停止 ComfyUI？"),
      body: (
        <>
          <p>
            {force
              ? tr("正常停止未完成。强制结束会立即终止本次由编辑器启动的 ComfyUI。")
              : tr("当前有 {0} 个任务正在生成，另有 {1} 个任务等待。停止服务会中止当前生成，等待任务将无法继续。", active, pending)}
          </p>
          {!force && active > 0 && (
            <p className="hint">{tr("仅想中断这一次生成？可以保留服务运行，改用“中断当前任务”。")}</p>
          )}
        </>
      ),
      confirm: force ? tr("强制结束") : tr("停止 ComfyUI"),
      danger: true,
      third: !force && active > 0 ? tr("中断当前任务") : undefined,
    });
    if (answer === "third") {
      await link.queueAction("interrupt");
      return;
    }
    if (answer !== "confirm" || gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      update(await rpc("process.stop", { confirmed: true, force }));
    } catch (e) {
      setError(String(e));
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  async function preference(p: Partial<ProcessConfig>) {
    try {
      setConfig(await rpc("process.preferences", p));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  async function save(c: ProcessConfig, address: string) {
    const result = await rpc<ConfigResult>("process.save", {
      config: c,
      url: address,
    });
    setConfig(result.config);
    setUrl(result.url);
    setError("");
    await app.refresh();
  }
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        await poll();
      } catch (e) {
        if (alive.current) setError(tr("无法读取进程状态：{0}", e));
      }
      if (alive.current) timer = setTimeout(tick, 1000);
    }
    void (async () => {
      try {
        await load();
        const initial = await rpc<ProcessState>("process.poll", {
          logs: page.current === "console",
        });
        update(initial);
        const saved = await rpc<ConfigResult>("process.config");
        if (
          alive.current &&
          saved.config.autoStart &&
          !initial.owned &&
          initial.status !== "external"
        ) {
          try {
            update(await rpc("process.start"));
            pendingWeb.current = !!saved.config.openWebOnStart;
            if (saved.config.openConsole) app.open("console");
          } catch (e) {
            if (alive.current) {
              setError(String(e));
              app.open("console");
            }
          }
        }
      } catch (e) {
        if (alive.current) setError(String(e));
      }
      if (alive.current) void tick();
    })();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (app.page === "console") void poll().catch((e) => setError(String(e)));
  }, [app.page]);
  useEffect(() => {
    setUrl(app.data.bridge.comfyUrl);
  }, [app.data.bridge.comfyUrl]);
  return (
    <ProcessContext.Provider
      value={{
        state,
        config,
        url,
        error,
        busy,
        load,
        poll,
        start,
        stop,
        preference,
        save,
        openWeb,
      }}
    >
      {children}
    </ProcessContext.Provider>
  );
}

function Status({ state }: { state: ProcessState }) {
  return (
    <span className={`process-status ${state.status}`}>
      <i />
      {tr(labels[state.status] || "") || tr("读取中")}
    </span>
  );
}
export function ComfyServiceCard() {
  const app = useApp(),
    link = useLink(),
    process = useComfyProcess();
  const { state, busy } = process;
  return (
    <section className="process-service" aria-label={tr("ComfyUI 服务")}>
      <ComfyConnectionCard />
      <div className="process-service-state">
        <Status state={state} />
        <small>{tr("本机 ·") + " "}{state.port}</small>
      </div>
      <div className="process-service-actions">
        <IconButton icon={ArrowSquareOut} label={tr("打开 ComfyUI 网页")} onClick={() => void process.openWeb().catch((e) => app.reportError(String(e)))} />
        <IconButton
          icon={TerminalWindow}
          label={tr("打开 ComfyUI 控制台")}
          active={app.page === "console"}
          onClick={() => app.open("console")}
        />
        <IconButton
          icon={CaretRight}
          label={tr("连接与队列")}
          onClick={link.connect}
        />
        {state.owned ? (
          <IconButton
            icon={Stop}
            label={tr("停止 ComfyUI…")}
            className="process-stop"
            disabled={busy || state.status === "stopping"}
            onClick={() => void process.stop()}
          />
        ) : (
          <IconButton
            icon={Play}
            label={
              state.status === "external"
                ? tr("ComfyUI 已由外部启动")
                : tr("启动 ComfyUI")
            }
            disabled={busy || state.status === "external"}
            onClick={() => void process.start()}
          />
        )}
      </div>
    </section>
  );
}

export function ComfyConsolePage() {
  const app = useApp(),
    link = useLink(),
    process = useComfyProcess();
  const { state, config, error, busy } = process;
  const scroll = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(config?.autoScroll ?? true);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    setFollowing(config?.autoScroll ?? true);
  }, [config?.autoScroll]);
  useEffect(() => {
    if (app.page === "console" && following && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [state.lines, app.page, following, config?.wrap]);
  const lines = state.lines || [];
  const runAction = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setActionError("");
    } catch (e) {
      setActionError(String(e));
    }
  };
  const q = link.status.live.queue;
  return (
    <div className="comfy-console-page">
      <header className="process-heading">
        <h1>{tr("ComfyUI 控制台")}</h1>
        <div className="page-actions">
          <IconButton
            icon={state.status === "starting" ? SpinnerGap : Play}
            label={tr("启动 ComfyUI")}
            disabled={busy || state.owned || state.status === "external"}
            onClick={() => void process.start()}
          />
          <IconButton
            icon={Stop}
            label={state.canForce ? tr("强制结束 ComfyUI…") : tr("停止 ComfyUI…")}
            className="process-stop"
            disabled={
              busy ||
              !state.owned ||
              (state.status === "stopping" && !state.canForce)
            }
            onClick={() => void process.stop(state.canForce)}
          />
          <span className="process-divider" />
          <IconButton
            icon={ArrowSquareOut}
            label={tr("打开 ComfyUI 网页")}
            onClick={() => void runAction(process.openWeb)}
          />
          <IconButton
            icon={Gear}
            label={tr("ComfyUI 设置")}
            onClick={() => openComfySettings(app)}
          />
        </div>
      </header>
      <div className="process-page-body">
        <section className="process-summary">
          <div>
            <Status state={state} />
            <small>{tr("本机")}</small>
          </div>
          <span className="process-divider" />
          <div>
            <span>127.0.0.1 : {state.port}</span>
            <small>
              {state.pid
                ? tr("PID {0} · 已运行 {1}:{2}", state.pid, Math.floor(state.elapsed / 60)
                    .toString()
                    .padStart(
                      2,
                      "0",
                    ), (state.elapsed % 60).toString().padStart(2, "0"))
                : tr("由 Prompt Editor 管理本机服务")}
            </small>
          </div>
          <button className="process-queue" onClick={link.connect}>{tr("正在生成") + " "}{q?.running.length || 0}{" " + tr("· 等待") + " "}{q?.pending.length || 0}
            <CaretRight size={16} />
          </button>
        </section>
        {(error || actionError || state.message) && (
          <Notice error={!!(error || actionError) || state.status === "failed"}>
            {trDiagnostic(error || actionError || state.message || "")}
            {state.status === "failed" && (
              <button onClick={() => openComfySettings(app)}>{tr("编辑启动配置")}</button>
            )}
          </Notice>
        )}
        <section className="process-terminal" aria-label={tr("ComfyUI 运行日志")}>
          <div className="process-log-toolbar">
            <TerminalWindow size={16} />
            <span>{tr("运行日志")}</span>
            <small>{lines.length}{" " + tr("行")}</small>
            <div className="process-log-actions">
              <IconButton
                icon={Copy}
                label={tr("复制日志")}
                disabled={!lines.length}
                onClick={() =>
                  void runAction(async () => {
                    await navigator.clipboard.writeText(lines.join("\n"));
                    app.notify(tr("已复制当前保留日志"));
                  })
                }
              />
              <IconButton
                icon={Broom}
                label={tr("清屏（保留服务运行）")}
                disabled={!lines.length}
                onClick={() =>
                  void runAction(async () => {
                    await rpc("process.clear");
                    await process.poll();
                  })
                }
              />
              <IconButton
                icon={TextAlignLeft}
                label={tr("日志自动换行")}
                active={config?.wrap}
                onClick={() => void process.preference({ wrap: !config?.wrap })}
              />
              <IconButton
                icon={ArrowDown}
                label={following ? tr("暂停自动滚动") : tr("滚动到最新日志")}
                active={following}
                onClick={() => {
                  setFollowing(!following);
                  if (!following && scroll.current)
                    scroll.current.scrollTop = scroll.current.scrollHeight;
                  void process.preference({ autoScroll: !following });
                }}
              />
            </div>
          </div>
          <div
            className={`process-log-scroll ${config?.wrap ? "wrap" : ""}`}
            ref={scroll}
            tabIndex={0}
            onScroll={() => {
              const el = scroll.current;
              if (el)
                setFollowing(
                  el.scrollHeight - el.clientHeight - el.scrollTop < 24,
                );
            }}
          >
            {lines.length ? (
              lines.map((text, i) => (
                <div
                  key={i}
                  className={`process-log-line ${/\[ERROR\]|Traceback|Error:/.test(text) ? "error" : /\[READY\]/.test(text) ? "ready" : /\[RUN\]/.test(text) ? "run" : ""}`}
                >
                  {text || "\u00a0"}
                </div>
              ))
            ) : (
              <div className="process-log-empty">
                <TerminalWindow size={32} />
                <strong>
                  {state.status === "external"
                    ? tr("外部服务正在运行")
                    : state.owned
                      ? tr("正在等待启动输出…")
                      : tr("启动后，日志显示在此处")}
                </strong>
                <span>
                  {state.status === "external"
                    ? tr("无法读取外部进程的控制台输出，可查看连接与队列。")
                    : tr("ComfyUI 在后台启动，控制台不会弹出新窗口。")}
                </span>
                {!state.owned && state.status !== "external" && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void process.start()}
                  >
                    <Play size={16} />{tr("启动 ComfyUI")}</button>
                )}
              </div>
            )}
          </div>
          <footer className="process-log-footer">
            <span>{following ? tr("自动滚动已开启") : tr("已暂停跟随")}</span>
            <span>{tr("切换或关闭此标签页后，ComfyUI 继续运行")}</span>
          </footer>
        </section>
      </div>
    </div>
  );
}

export function ComfySettings() {
  const app = useApp(),
    process = useComfyProcess();
  const [draft, setDraft] = useState<ProcessConfig | null>(process.config);
  const [url, setUrl] = useState(process.url);
  const [baseline, setBaseline] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);
  const current = JSON.stringify({ config: draft, url });
  const dirty = !!draft && !!baseline && current !== baseline;
  useEffect(() => {
    if (!dirty && process.config) {
      setDraft(process.config);
      setUrl(process.url);
      setBaseline(JSON.stringify({ config: process.config, url: process.url }));
    }
  }, [process.config, process.url]);
  const draftRef = useRef({ draft, url, dirty });
  draftRef.current = { draft, url, dirty };
  const reset = () => {
    setDraft(process.config);
    setUrl(process.url);
    setBaseline(JSON.stringify({ config: process.config, url: process.url }));
    setError("");
    setTest("");
  };
  const save = async () => {
    const value = draftRef.current;
    if (!value.draft) return false;
    if (
      !Number.isInteger(value.draft.port) ||
      value.draft.port < 1 ||
      value.draft.port > 65535
    ) {
      setError(tr("端口必须为 1–65535 的整数"));
      return false;
    }
    if (
      !Number.isInteger(value.draft.logLimit) ||
      value.draft.logLimit < 100 ||
      value.draft.logLimit > 50000
    ) {
      setError(tr("日志保留上限必须为 100–50000 的整数"));
      return false;
    }
    setBusy(true);
    try {
      await process.save(value.draft, value.url);
      setBaseline(JSON.stringify({ config: value.draft, url: value.url }));
      setError("");
      app.notify(tr("ComfyUI 设置已保存；启动环境变更将在下次启动生效"));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    app.draftGuards.current.set("settings", async () => {
      if (!draftRef.current.dirty) return true;
      openComfySettings(app);
      const answer = await app.confirm({
        title: tr("保存 ComfyUI 设置？"),
        body: <p>{tr("ComfyUI 设置有未保存更改。")}</p>,
        confirm: tr("保存"),
        third: tr("放弃更改"),
      });
      if (answer === "cancel") return false;
      if (answer === "third") {
        reset();
        return true;
      }
      return saveRef.current();
    });
    return () => {
      app.draftGuards.current.delete("settings");
    };
  }, [process.config, process.url]);
  if (!draft)
    return <Notice>{process.error || tr("正在读取 ComfyUI 设置…")}</Notice>;
  const change = <K extends keyof ProcessConfig>(
    key: K,
    value: ProcessConfig[K],
  ) => {
    setDraft({ ...draft, [key]: value });
    setError("");
    setTest("");
  };
  const field = (
    name: string,
    key: "directory" | "python" | "extraArgs",
    directory?: boolean,
  ) => (
    <label className="process-field">
      <span>{name}</span>
      <div className="process-input-group">
        <input
          value={draft[key]}
          onChange={(e) => change(key, e.target.value)}
          aria-label={name}
        />
        {key !== "extraArgs" && (
          <IconButton
            icon={FolderOpen}
            label={tr("选择{0}", name)}
            onClick={() =>
              void (async () => {
                try {
                  const path = await pick(
                    directory
                      ? { directory: true }
                      : { filters: [{ name: "Python", extensions: ["exe"] }] },
                  );
                  if (typeof path === "string") change(key, path);
                } catch (e) {
                  setError(String(e));
                }
              })()
            }
          />
        )}
      </div>
    </label>
  );
  const toggle = (
    label: string,
    key: "lan" | "openConsole" | "autoScroll" | "wrap" | "autoStart" | "openWebOnStart",
  ) => (
    <div className="process-setting-switch">
      <span>{label}</span>
      <Switch
        label={label}
        checked={draft[key]}
        onChange={(v) => change(key, v)}
      />
    </div>
  );
  const mismatch =
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url) &&
    (() => {
      try {
        return Number(new URL(url).port || 80) !== draft.port;
      } catch {
        return false;
      }
    })();
  return (
    <div className="process-settings">
      <div className="process-settings-heading">
        <h2>ComfyUI</h2>
        <span className="process-settings-test">{test}</span>
        <IconButton
          icon={TerminalWindow}
          label={tr("打开 ComfyUI 控制台")}
          onClick={() => app.open("console")}
        />
      </div>
      <div className="process-settings-grid">
        <section className="process-settings-card">
          <h3>{tr("ComfyUI 网页")}</h3>
          <label className="process-field"><span>{tr("网页打开方式")}</span>
            <select aria-label={tr("ComfyUI 网页打开方式")} value={draft.webOpenMode} onChange={(e) => change("webOpenMode", e.target.value as ProcessConfig["webOpenMode"])}>
              <option value="tab">{tr("编辑器内置标签页")}</option><option value="browser">{tr("默认浏览器")}</option>
            </select>
          </label>
          <label className="process-field"><span>{tr("网页地址（可选）")}</span>
            <input aria-label={tr("ComfyUI 网页地址")} placeholder={tr("留空使用服务地址")} value={draft.webUrl} onChange={(e) => change("webUrl", e.target.value)} />
          </label>
          {toggle(tr("服务启动就绪后自动打开网页"), "openWebOnStart")}
          <p className="hint">{tr("留空时跟随连接中的服务地址。打开入口使用已保存的设置。")}</p>
          <button onClick={() => void process.openWeb().catch((e) => app.reportError(String(e)))}>{tr("打开 ComfyUI 网页")}</button>
        </section>
        <section className="process-settings-card">
          <h3>{tr("连接")}</h3>
          <label className="process-field">
            <span>{tr("服务地址")}</span>
            <input
              aria-label={tr("服务地址")}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTest("");
              }}
            />
          </label>
          <div className="process-connection-test">
            <IconButton
              icon={ArrowsClockwise}
              label={tr("测试 ComfyUI 连接")}
              disabled={busy}
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  setTest(tr("正在连接…"));
                  try {
                    await rpc("process.test", { url });
                    setTest(tr("连接正常"));
                  } catch (e) {
                    setTest("");
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                })()
              }
            />
            <span>
              {test ||
                (app.data.bridge.comfyConnected ? tr("已连接") : tr("尚未测试连接"))}
            </span>
          </div>
          <hr />
          {toggle(tr("允许局域网访问"), "lan")}
          <label className="process-field">
            <span>{tr("本机服务端口")}</span>
            <input
              aria-label={tr("本机服务端口")}
              type="number"
              min="1"
              max="65535"
              value={draft.port || ""}
              onChange={(e) => change("port", Number(e.target.value))}
            />
          </label>
          {mismatch ? (
            <p className="hint">{tr("服务地址与本机端口不一致。")}<button onClick={() => setUrl(`http://127.0.0.1:${draft.port}`)}>{tr("同步本机地址")}</button>
            </p>
          ) : (
            <p className="hint">{tr("局域网访问与端口修改将在下次启动生效。")}</p>
          )}
        </section>
        <section className="process-settings-card">
          <h3>{tr("本机启动")}</h3>
          {field(tr("ComfyUI 目录"), "directory", true)}
          {field(tr("Python 可执行文件"), "python")}
          {field(tr("附加启动参数（可选）"), "extraArgs")}
          <p className="hint">{tr("后台启动，输出显示在控制台标签页。")}<br />{tr("修改启动配置后，下次启动生效。")}</p>
        </section>
        <section className="process-settings-card">
          <h3>{tr("控制台")}</h3>
          {toggle(tr("启动后打开控制台标签页"), "openConsole")}
          {toggle(tr("自动滚动到最新日志"), "autoScroll")}
          {toggle(tr("日志自动换行"), "wrap")}
          <label className="process-field">
            <span>{tr("日志保留上限（行）")}</span>
            <input
              aria-label={tr("日志保留上限（行）")}
              type="number"
              min="100"
              max="50000"
              value={draft.logLimit || ""}
              onChange={(e) => change("logLimit", Number(e.target.value))}
            />
          </label>
        </section>
        <section className="process-settings-card">
          <h3>{tr("启动与退出")}</h3>
          {toggle(tr("打开编辑器时启动 ComfyUI"), "autoStart")}
          <label className="process-field">
            <span>{tr("关闭编辑器时")}</span>
            <select
              aria-label={tr("关闭编辑器时")}
              value={draft.exitPolicy}
              onChange={(e) =>
                change(
                  "exitPolicy",
                  e.target.value as ProcessConfig["exitPolicy"],
                )
              }
            >
              <option value="ask">{tr("每次询问")}</option>
              <option value="keep">{tr("保留 ComfyUI")}</option>
              <option value="stop">{tr("停止并退出")}</option>
            </select>
          </label>
          <p className="hint">{tr("关闭控制台标签页时，服务继续运行。")}<br />{tr("只管理由编辑器启动的 ComfyUI。")}</p>
        </section>
      </div>
      {(error || process.error) && (
        <Notice error>{error || process.error}</Notice>
      )}
      <footer className="process-settings-footer">
        <span>{dirty ? tr("有未保存更改") : tr("更改仅保存在此设备")}</span>
        <button disabled={busy || !dirty} onClick={reset}>{tr("取消更改")}</button>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >{tr("保存设置")}</button>
      </footer>
    </div>
  );
}

export async function prepareComfyExit(
  confirm: (o: ConfirmOptions) => Promise<"confirm" | "cancel" | "third">,
) {
  const state = await rpc<ProcessState>("process.poll", { logs: false });
  if (!state.owned) return true;
  const { config } = await rpc<ConfigResult>("process.config");
  if (config.exitPolicy === "keep") return true;
  if (config.exitPolicy === "ask") {
    const answer = await confirm({
      title: tr("关闭 Prompt Editor"),
      body: (
        <p>{tr("ComfyUI 仍在运行。请选择保留服务，或停止 ComfyUI 后退出编辑器。")}</p>
      ),
      confirm: tr("停止并退出"),
      third: tr("保留 ComfyUI"),
    });
    if (answer === "cancel") return false;
    if (answer === "third") return true;
  }
  if (state.status !== "stopping")
    await rpc("process.stop", { confirmed: true });
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 500));
    if (!(await rpc<ProcessState>("process.poll", { logs: false })).owned)
      return true;
  }
  const answer = await confirm({
    title: tr("ComfyUI 尚未停止"),
    body: <p>{tr("可以继续等待，或强制结束本次由编辑器启动的进程后退出。")}</p>,
    confirm: tr("强制结束并退出"),
    danger: true,
    cancel: tr("继续等待"),
  });
  if (answer !== "confirm") return false;
  await rpc("process.stop", { confirmed: true, force: true });
  await new Promise((r) => setTimeout(r, 500));
  return !(await rpc<ProcessState>("process.poll", { logs: false })).owned;
}
