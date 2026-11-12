import { getLocale, tr, trDiagnostic } from "./i18n";
import { isTauri } from "@tauri-apps/api/core";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Play,
  CaretDown,
  CaretUp,
  ArrowSquareOut,
  ArrowsClockwise,
  Images,
  SpinnerGap,
  WarningCircle,
  Trash,
  Copy,
  LinkSimple,
  FolderOpen,
  Broom,
  Desktop,
  Cpu,
  Browser,
  ArrowsLeftRight,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Clock,
  X,
  Gear,
  CaretRight,
  Stack,
  Lock,
  TextT,
  StopCircle,
} from "@phosphor-icons/react";
import { rpc, openExternal, openFile, reveal } from "./api";
import {
  parameterChanges,
  mappingChanges,
  belongsToProject,
} from "./parameter-diff";
import { attachFilmScrolling } from "./film-scroll";
import { ResultViewport, ResultImagePlane } from "./result-viewport";
import { useApp } from "./context";
import { IconButton, Menu, Modal, MiddleEllipsis, useTooltip } from "./ui";
import type { EditingState, Generation } from "./types";

type Output = {
  filename: string;
  subfolder: string;
  type: string;
  node_id: string;
};
export type Run = {
  project_path?: string | null;
  request_id: string;
  session_id?: string;
  server_url: string;
  created: string;
  state: EditingState;
  snapshot: {
    snapshot_id: string;
    generation: Generation;
    project_id?: string;
    comfy_group_targets?: Record<string, string>;
  };
  status: string;
  prompt_id?: string;
  outputs: Output[];
  error?: string;
  execution_error?: {
    node_id?: string;
    node_type?: string;
    node_title?: string;
    exception_type?: string;
    exception_message?: string;
    [key: string]: unknown;
  };
  probe?: { id: string; value: number; target: string; kind: string };
  film_hidden?: boolean;
};
type BrowserPage = {
  fingerprint?: string;
  client_id: string;
  workflow: string;
  bridges: { editor_url: string }[];
};
type Progress = {
  remaining_seconds?: number;
  elapsed_seconds?: number;
  node?: string;
  value?: number;
  max?: number;
  preview?: string;
};
type LinkState = {
  session_id?: string;
  revision?: string;
  unchanged?: boolean;
  probes?: any[];
  runs: Run[];
  live: {
    pages?: BrowserPage[];
    queue?: { running: string[]; pending: string[] };
    runs?: { request_id: string; progress?: Progress }[];
  };
};
type Issue = {
  kind: string;
  message: string;
  blocking: boolean;
  name?: string;
  options?: {
    name: string;
    bypasser_id: string;
    title?: string;
    description?: string;
  }[];
};
type Check = { issues: Issue[]; pages?: BrowserPage[] };
type Diff = {
  rows: {
    id: string;
    side: string;
    label: string;
    from?: string;
    to?: string;
    to_weight?: number | string;
  }[];
  revision: string;
};
type Options = {
  count?: number;
  lock_seed?: boolean;
  mode?: string;
  source_request?: string;
  random_seed?: boolean;
  probe_id?: string;
  indices?: number[];
};
type LinkContext = {
  imageActions: (
    run: Run,
    index: number,
  ) => {
    label: string;
    icon: typeof Copy;
    action: () => Promise<void>;
    disabled: boolean;
  }[];
  restore: (run: Run) => Promise<boolean>;
  pick: (run: Run, index?: number) => Promise<void>;
  status: LinkState;
  error: string;
  busy: boolean;
  checking: boolean;
  client: string;
  setClient: (s: string) => void;
  submit: (o?: Options) => Promise<void>;
  connect: () => void;
  inspect: (
    r: Run,
    index?: number,
    results?: { run: Run; index: number }[],
  ) => void;
  imageMenu: (r: Run, index: number, x: number, y: number) => void;
  parameterMenu: (r: Run, x: number, y: number) => void;
  toggleFilm: () => void;
  film: boolean;
  queueAction: (action: string, prompt_id?: string) => Promise<void>;
  poll: () => Promise<void>;
};
const Link = createContext<LinkContext>(null!);
export const useLink = () => useContext(Link);
const unresolved = (r: Run) =>
  ["dispatching", "claimed", "unknown"].includes(r.status);
const active = (r: Run) =>
  ["dispatching", "claimed", "unknown", "queued", "running"].includes(r.status);
export const labels: Record<string, string> = {
  dispatching: "等待浏览器受理",
  claimed: "提交中",
  unknown: "受理待核对",
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  rejected: "未提交",
  failed: "生成失败",
  cancelled: "已取消",
};
export function changes(
  from: EditingState,
  to: EditingState,
  onlySide?: "Positive" | "Negative",
) {
  const rows: string[] = [];
  for (const side of ["Positive", "Negative"] as const) {
    if (onlySide && onlySide !== side) continue;
    const a = from[side].Active,
      b = to[side].Active;
    const key = (t: (typeof a)[number], all: typeof a, index: number) =>
      `${t.Kind}:${t.Key}:${all.slice(0, index).filter((x) => x.Key === t.Key && x.Kind === t.Kind).length}`;
    const am = new Map(a.map((t, i) => [key(t, a, i), t])),
      bm = new Map(b.map((t, i) => [key(t, b, i), t]));
    for (const [id, t] of am) {
      const n = bm.get(id);
      if (!n) rows.push(`−${t.Base}`);
      else if (n.Raw !== t.Raw || n.Weight !== t.Weight)
        rows.push(
          t.Weight !== n.Weight
            ? `${t.Base} ${t.Weight}→${n.Weight}`
            : `${t.Base} → ${n.Raw}`,
        );
    }
    for (const [id, t] of bm) if (!am.has(id)) rows.push(`+${t.Base}`);
  }
  return rows;
}
const imageCache = new Map<string, string>();
let imageReads = 0;
const pendingImageReads: (() => void)[] = [];
function readResultImage(
  payload: unknown,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal.aborted) {
        reject(new Error(tr("图片读取已取消")));
        return;
      }
      imageReads++;
      void rpc<string>("runs.image", payload)
        .then(resolve, reject)
        .finally(() => {
          imageReads--;
          while (imageReads < 4 && pendingImageReads.length)
            pendingImageReads.shift()!();
        });
    };
    if (imageReads < 4) start();
    else pendingImageReads.push(start);
  });
}

export function ResultImage({
  run,
  index,
  full = false,
}: {
  run: Run;
  index: number;
  full?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const offline = !!useLink().error;
  const { page } = useApp();
  const loaded = useRef<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const key = `${run.server_url}/${run.request_id}/${index}/${full}`;
    const cached =
      imageCache.get(key) ||
      (loaded.current?.key === key ? loaded.current.url : "");
    if (cached) {
      setUrl(cached);
      setError("");
      return;
    }
    setUrl("");
    const load = () => {
      if (disposed) return;
      attempts++;
      setError("");
      void readResultImage(
        { request_id: run.request_id, index, full },
        controller.signal,
      )
        .then((url) => {
          if (disposed) return;
          if (!full) {
            if (imageCache.size > 128)
              imageCache.delete(imageCache.keys().next().value!);
            imageCache.set(key, url);
          }
          loaded.current = { key, url };
          setUrl(url);
        })
        .catch((e) => {
          if (disposed) return;
          setError(String(e));
          // Transient startup failures get a bounded backoff. Missing files must
          // not create an endless retry loop; reconnecting/revisiting can retry.
          const delay = [2000, 5000, 15000][attempts - 1];
          if (delay != null) retryTimer = setTimeout(load, delay);
        });
    };
    load();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      controller.abort();
    };
  }, [run.server_url, run.request_id, index, full, offline, page]);
  return url ? (
    <img
      src={url}
      alt={tr("生成结果 {0} · Seed {1}", index + 1, run.snapshot.generation.seed)}
    />
  ) : (
    <span
      className="result-placeholder"
      aria-label={error ? tr("图片暂不可读") : tr("正在读取图片")}
      title={error || tr("正在读取图片")}
    >
      {error ? (
        <WarningCircle size={28} className="film-status-icon" />
      ) : (
        <SpinnerGap size={28} className="film-status-icon is-loading" />
      )}
    </span>
  );
}

export function ComfyLinkProvider({ children }: { children: ReactNode }) {
  const app = useApp();
  useEffect(() => {
    const listener = (e: Event) => {
      sessionStorage.setItem(
        "probe-target",
        JSON.stringify((e as CustomEvent).detail),
      );
      app.open("probe");
    };
    window.addEventListener("prompt-editor.probe", listener);
    return () => window.removeEventListener("prompt-editor.probe", listener);
  }, [app.open]);
  const [imageMenu, setImageMenu] = useState<{
    run: Run;
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageGate = useRef(false);
  async function imageAction(run: Run, index: number, action: string) {
    if (imageGate.current) return;
    imageGate.current = true;
    setImageBusy(true);
    try {
      if (action === "copy") {
        // Start the clipboard write during the user's gesture; resolve the full image asynchronously.
        const blob = rpc<string>("runs.image", {
          request_id: run.request_id,
          index,
          full: true,
        }).then((data) => {
          const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) =>
            c.charCodeAt(0),
          );
          return new Blob([bytes], { type: "image/png" });
        });
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
      } else {
        const { path } = await rpc<{ path: string }>("runs.file", {
          request_id: run.request_id,
          index,
        });
        if (action === "path") await navigator.clipboard.writeText(path);
        else if (action === "reveal") await reveal(path);
        else await openFile(path);
      }
      app.notify(
        action === "copy"
          ? tr("图片已复制")
          : action === "path"
            ? tr("图片路径已复制")
            : action === "reveal"
              ? tr("已在资源管理器中定位图片")
              : tr("已请求默认应用打开图片"),
      );
    } catch (e) {
      app.reportError(tr("图片操作失败：{0}", String(e)));
    } finally {
      imageGate.current = false;
      setImageBusy(false);
    }
  }
  const imageActions = (run: Run, index: number) => [
    {
      label: tr("复制图片"),
      icon: Copy,
      action: () => imageAction(run, index, "copy"),
      disabled: imageBusy,
    },
    {
      label: tr("复制图片路径"),
      icon: LinkSimple,
      action: () => imageAction(run, index, "path"),
      disabled: imageBusy,
    },
    {
      label: tr("在资源管理器中显示"),
      icon: FolderOpen,
      action: () => imageAction(run, index, "reveal"),
      disabled: imageBusy,
    },
    {
      label: tr("用默认应用打开"),
      icon: ArrowSquareOut,
      action: () => imageAction(run, index, "open"),
      disabled: imageBusy,
    },
  ];
  const [status, setStatus] = useState<LinkState>({ runs: [], live: {} }),
    [error, setError] = useState("");
  const [client, setClient] = useState(""),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState(false),
    [film, setFilm] = useState(
      () => localStorage.getItem("comfy-film") !== "closed",
    );
  const connectionTrigger = useRef<HTMLElement | null>(null);
  const [connectionDetails, setConnectionDetails] = useState(false);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [controlBusy, setControlBusy] = useState(false);
  async function diagnose() {
    setControlBusy(true);
    try {
      setDiagnostics(await rpc("runs.diagnostics"));
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setControlBusy(false);
    }
  }
  useEffect(() => {
    if (connection) {
      setDiagnostics(null);
      void diagnose();
    }
  }, [connection, app.data.bridge.comfyUrl]);
  const [check, setCheck] = useState<Check | null>(null),
    [options, setOptions] = useState<Options>({});
  const [mapping, setMapping] = useState<Issue | null>(null),
    [mappingTarget, setMappingTarget] = useState("");
  const [selected, setSelected] = useState<{ run: Run; index: number } | null>(
      null,
    ),
    [diff, setDiff] = useState<Diff | null>(null);
  const [parameterMenu, setParameterMenu] = useState<{
    run: Run;
    x: number;
    y: number;
  } | null>(null);
  const [snapshotRun, setSnapshotRun] = useState<Run | null>(null);
  const applyGate = useRef(false);
  const [selectedRows, setSelectedRows] = useState<string[]>([]),
    [applyBusy, setApplyBusy] = useState(false);
  const [resultDetails, setResultDetails] = useState(false);
  const [resultSequence, setResultSequence] = useState<
    { run: Run; index: number }[] | null
  >(null);
  const navigable =
    resultSequence ||
    status.runs
      .slice()
      .reverse()
      .flatMap((run) => run.outputs.map((_, index) => ({ run, index })));
  const resultPosition = selected
    ? navigable.findIndex(
        (item) =>
          item.run.request_id === selected.run.request_id &&
          item.index === selected.index,
      )
    : -1;
  const moveResult = (direction: number) => {
    const next = navigable[resultPosition + direction];
    if (resultPosition >= 0 && next && !applyBusy) setSelected(next);
  };
  useEffect(() => {
    if (!selected || diff) return;
    const navigate = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      const target = event.target as HTMLElement;
      const dialogs = document.querySelectorAll("[role=dialog]");
      if (
        !dialogs
          .item(dialogs.length - 1)
          ?.classList.contains("run-detail-dialog") ||
        document.querySelector("[role=menu]")
      )
        return;
      if (
        target.closest?.(
          "input,textarea,select,[contenteditable=true],[role=slider]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        moveResult(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", navigate);
    return () => document.removeEventListener("keydown", navigate);
  }, [selected, diff, resultPosition, navigable, applyBusy]);
  const gate = useRef(false),
    pollGate = useRef(false),
    latest = useRef(status),
    callbacks = useRef<any>({}),
    lastRow = useRef(0);
  latest.current = status;
  const pollRevision = useRef("");
  const update = (next: LinkState) => {
    if (next.unchanged)
      next = {
        ...next,
        runs: latest.current.runs,
        probes: latest.current.probes,
      };
    if (next.revision) pollRevision.current = next.revision;
    next = {
      ...next,
      session_id: next.session_id || latest.current.session_id,
      runs: next.runs || [],
      live: next.live || {},
    };
    latest.current = next;
    setStatus(next);
  };
  async function poll() {
    if (pollGate.current || gate.current) return;
    pollGate.current = true;
    try {
      const next = await rpc<LinkState>("runs.poll", {
        revision: pollRevision.current,
      });
      update(next);
      if (isTauri())
        void rpc<{ notification_error?: string; progress_error?: string }>(
          "runs.feedback",
          { locale: getLocale() },
        )
          .then((r) => {
            if (r.notification_error) app.notify(trDiagnostic(r.notification_error));
          })
          .catch(() => {});
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      pollGate.current = false;
    }
  }
  async function flush() {
    await app.flush.current();
    for (const f of app.draftFlushers.current.values()) await f();
  }
  async function submit(o: Options = {}) {
    if (gate.current) return;
    if (latest.current.runs.some(unresolved)) {
      setConnection(true);
      void poll();
      return;
    }
    gate.current = true;
    setBusy(true);
    const timer = setTimeout(() => setChecking(true), 300);
    try {
      if (!o.source_request) await flush();
      const result = await rpc<LinkState & { preflight?: Check }>(
        "runs.submit",
        { ...o, client_id: client },
      );
      setOptions(o);
      if (result.preflight) {
        setCheck(result.preflight);
      } else {
        update(result);
        setCheck(null);
        setFilm(true);
        app.notify(tr("已锁定提交快照；后续编辑不会影响此任务"));
      }
    } catch (e) {
      setError(String(e));
      app.reportError(String(e));
    } finally {
      clearTimeout(timer);
      gate.current = false;
      setBusy(false);
      setChecking(false);
    }
  }
  async function recheck() {
    try {
      if (!options.source_request) await flush();
      setCheck(
        await rpc<Check>("runs.preflight", { ...options, client_id: client }),
      );
    } catch (e) {
      app.reportError(String(e));
    }
  }
  async function queueAction(action: string, prompt_id?: string) {
    const q = latest.current.live.queue;
    const ids = q?.pending || [];
    prompt_id ||= q?.running[0];
    if (action === "interrupt" && !prompt_id) return;
    if (action === "clear" && !ids.length) return;
    const reopenConnection = connection;
    setConnection(false);
    const answer = await app.confirm({
      title:
        action === "interrupt"
          ? tr("中断当前任务？")
          : action === "clear"
            ? tr("清空等待队列？")
            : tr("取消等待任务？"),
      body:
        action === "interrupt" ? (
          <p>{tr("中断当前 1 个正在生成的任务。等待队列中的") + " "}{ids.length}{" "}{tr("个任务将继续保留。")}</p>
        ) : action === "clear" ? (
          <p>{tr("取消等待队列中的") + " "}{ids.length}{" " + tr("个任务。当前生成继续执行。")}</p>
        ) : (
          <p>{tr("取消选定的 1 个等待任务。")}</p>
        ),
      confirm: action === "interrupt" ? tr("中断当前") : tr("确认取消"),
      danger: true,
    });
    if (reopenConnection) setConnection(true);
    if (answer !== "confirm") return;
    try {
      await rpc("runs.queue", { action, prompt_id, ids, confirmed: true });
      await poll();
    } catch (e) {
      app.reportError(String(e));
    }
  }
  async function loadDiff(run: Run) {
    await flush();
    const d = await rpc<Diff>("runs.diff", { request_id: run.request_id });
    setDiff(d);
    setSelectedRows([]);
  }
  async function restoreVersion(run: Run, snapshotName?: string) {
    if (applyGate.current) return false;
    if (
      snapshotName === undefined &&
      (await app.confirm({
        title: tr("应用此记录的完整参数？"),
        body: (
          <p>{tr("覆盖当前项目的积极 / 消极提示词、视觉组与成员、工作流分组、Seed、生成参数和模型设置。可 Ctrl+Z 撤销。")}</p>
        ),
        confirm: tr("确认应用"),
      })) !== "confirm"
    )
      return false;
    applyGate.current = true;
    setApplyBusy(true);
    try {
      await flush();
      const d = await rpc<Diff>("runs.diff", { request_id: run.request_id });
      await app.act("runs.apply", {
        request_id: run.request_id,
        revision: d.revision,
        full: true,
        generation: true,
        save_snapshot: snapshotName !== undefined,
        snapshot_name: snapshotName,
      });
      setSelected(null);
      setSnapshotRun(null);
      app.notify(
        snapshotName !== undefined
          ? tr("已保存快照并应用完整参数 · Ctrl+Z 可撤销")
          : tr("已应用完整参数 · Ctrl+Z 可撤销"),
      );
      return true;
    } catch (e) {
      app.reportError(String(e));
      throw e;
    } finally {
      applyGate.current = false;
      setApplyBusy(false);
    }
  }
  async function deleteRecord(run: Run) {
    if (
      (await app.confirm({
        title: tr("删除生成记录？"),
        body: <p>{tr("移除这次生成的记录及胶片条中的所有结果，原始图片保留。")}</p>,
        confirm: tr("删除记录"),
        danger: true,
      })) !== "confirm"
    )
      return;
    try {
      update(
        await rpc<LinkState>("runs.delete", {
          request_id: run.request_id,
          confirmed: true,
        }),
      );
      if (selected?.run.request_id === run.request_id) {
        setSelected(null);
        setDiff(null);
      }
      app.notify(tr("生成记录已删除，原图保留"));
    } catch (e) {
      app.reportError(String(e));
    }
  }
  async function apply(full: boolean) {
    if (!selected || !diff || applyBusy) return;
    if (full) {
      await restoreVersion(selected.run).catch(() => {});
      return;
    }
    setApplyBusy(true);
    try {
      await flush();
      await app.act("runs.apply", {
        request_id: selected.run.request_id,
        revision: diff.revision,
        full,
        ids: selectedRows,
      });
      app.notify(tr("已应用所选差异 · Ctrl+Z 可撤销"));
      setDiff(null);
      setSelected(null);
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setApplyBusy(false);
    }
  }
  callbacks.current = { submit, queueAction, poll };
  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined,
      closed = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ request_id: string; action: string }>(
          "generation-notification-action",
          (event) => {
            const run = latest.current.runs.find(
              (r) => r.request_id === event.payload.request_id,
            );
            if (!run) return;
            if (event.payload.action === "again")
              void callbacks.current.submit({ source_request: run.request_id });
            else {
              app.open("runs");
              setSelected({ run, index: 0 });
              setResultSequence(null);
              setDiff(null);
            }
          },
        ),
      )
      .then((fn) => {
        if (closed) fn();
        else dispose = fn;
      });
    return () => {
      closed = true;
      dispose?.();
    };
  }, [app.open]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    void rpc<LinkState>("runs.list").then((s) => {
      if (!disposed) update(s);
    });
    const tick = async () => {
      await callbacks.current.poll();
      if (!disposed) timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [app.data.bridge.comfyUrl]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.isComposing ||
        e.repeat ||
        document.querySelector('[role="dialog"]') ||
        !(e.ctrlKey || e.metaKey)
      )
        return;
      if (e.key === "Enter") {
        e.preventDefault();
        void callbacks.current.submit({ lock_seed: e.shiftKey });
      }
      if (e.key === ".") {
        e.preventDefault();
        void callbacks.current.queueAction("interrupt");
      }
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        setFilm((v) => !v);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);
  useEffect(() => {
    localStorage.setItem("comfy-film", film ? "open" : "closed");
  }, [film]);
  useEffect(() => {
    if (app.data.settings.Compact) setFilm(false);
  }, [app.data.settings.Compact]);
  const value: LinkContext = {
    imageActions,
    restore: async (run) => {
      return restoreVersion(run).catch(() => false);
    },
    pick: async (run, index = 0) => {
      try {
        await loadDiff(run);
        setSelected({ run, index });
        setResultSequence(null);
      } catch (e) {
        app.reportError(String(e));
      }
    },
    imageMenu: (run, index, x, y) => setImageMenu({ run, index, x, y }),
    parameterMenu: (run, x, y) => setParameterMenu({ run, x, y }),
    status,
    error,
    busy,
    checking,
    client,
    setClient,
    submit,
    connect: () => {
      connectionTrigger.current = document.activeElement as HTMLElement;
      setConnection(true);
    },
    inspect: (run, index = 0, results) => {
      setResultSequence(
        results?.filter((item) => item.run.outputs.length) || null,
      );
      setSelected({ run, index });
      setDiff(null);
    },
    toggleFilm: () => setFilm((v) => !v),
    film,
    queueAction,
    poll,
  };
  const browserSelect = (
    <label className="link-browser-select">{tr("浏览器工作流")}<select
        aria-label={tr("生成目标工作流")}
        value={client}
        onChange={(e) => setClient(e.target.value)}
      >
        <option value="">{tr("自动选择唯一在线页面")}</option>
        {(check?.pages || status.live.pages || []).map((p) => (
          <option key={p.client_id} value={p.client_id}>
            {p.workflow} · {p.client_id.slice(0, 8)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Link.Provider value={value}>
      {children}
      {imageMenu && (
        <Menu
          x={imageMenu.x}
          y={imageMenu.y}
          onClose={() => setImageMenu(null)}
          items={imageActions(imageMenu.run, imageMenu.index)}
        />
      )}
      {parameterMenu && (
        <Menu
          x={parameterMenu.x}
          y={parameterMenu.y}
          onClose={() => setParameterMenu(null)}
          items={[
            {
              label: tr("重新生成"),
              icon: Play,
              disabled: busy,
              action: () =>
                void submit({ source_request: parameterMenu.run.request_id }),
            },
            {
              label: tr("重新生成（随机）"),
              icon: ArrowsClockwise,
              disabled: busy,
              action: () =>
                void submit({
                  source_request: parameterMenu.run.request_id,
                  random_seed: true,
                }),
            },
            {
              label: tr("保存快照后应用参数…"),
              icon: Stack,
              disabled: applyBusy,
              action: () => setSnapshotRun(parameterMenu.run),
            },
            {
              label: tr("应用参数…"),
              icon: ArrowsLeftRight,
              disabled: applyBusy,
              action: () =>
                void restoreVersion(parameterMenu.run).catch(() => {}),
            },
            {
              label: tr("删除记录…"),
              icon: Trash,
              danger: true,
              disabled: active(parameterMenu.run),
              action: () => void deleteRecord(parameterMenu.run),
            },
          ]}
        />
      )}
      {snapshotRun && (
        <SnapshotBeforeApply
          busy={applyBusy}
          onClose={() => {
            if (!applyBusy) setSnapshotRun(null);
          }}
          onSave={async (name) => {
            await restoreVersion(snapshotRun, name);
          }}
        />
      )}
      {connection && (
        <Modal
          title={tr("ComfyUI 连接与队列")}
          heading={tr("连接与队列")}
          width={400}
          className="link-connection"
          onClose={() => {
            setConnection(false);
            requestAnimationFrame(() => {
              const trigger = connectionTrigger.current;
              if (trigger?.isConnected && trigger.offsetParent !== null) {
                trigger.focus();
                return;
              }
              Array.from(
                document.querySelectorAll<HTMLButtonElement>(
                  ".comfy-connection-card, .comfy-progress-button",
                ),
              )
                .find((el) => el.offsetParent !== null)
                ?.focus();
            });
          }}
          footer={
            <>
              <button
                disabled={!status.live.queue?.running.length}
                onClick={() => void queueAction("interrupt")}
              >{tr("中断当前")}</button>
              <button
                disabled={
                  controlBusy ||
                  !diagnostics?.bridge ||
                  !diagnostics?.backend ||
                  !diagnostics?.queue ||
                  diagnostics.queue.queue_running?.length > 0 ||
                  diagnostics.queue.queue_pending?.length > 0 ||
                  status.runs.some(active)
                }
                title={tr("仅队列空闲且无待核对任务时可用")}
                onClick={async () => {
                  setControlBusy(true);
                  try {
                    await rpc("runs.free");
                    app.notify(
                      tr("已请求卸载模型并释放缓存；显存由 ComfyUI 异步释放"),
                    );
                  } catch (e) {
                    app.reportError(String(e));
                  } finally {
                    setControlBusy(false);
                    void diagnose();
                  }
                }}
              >{tr("释放显存")}</button>
              <IconButton
                icon={ArrowSquareOut}
                label={tr("打开 ComfyUI")}
                onClick={() =>
                  void openExternal(app.data.bridge.comfyUrl).catch((e) =>
                    app.reportError(String(e)),
                  )
                }
              />
              <IconButton
                icon={Trash}
                label={tr("清空等待队列")}
                disabled={!status.live.queue?.pending.length}
                onClick={() => void queueAction("clear")}
              />
            </>
          }
        >
          <p className="connection-address" title={app.data.bridge.comfyUrl}>
            {app.data.bridge.comfyUrl
              .replace(/^https?:\/\//, "")
              .replace(/\/$/, "")}
          </p>
          <div className="link-chain">
            {[
              {
                name: tr("编辑器"),
                icon: Desktop,
                ok: diagnostics?.editor && !app.data.bridge.error,
                detail: tr("本机 · 就绪"),
              },
              {
                name: diagnostics?.live?.bridge_version
                  ? `Bridge ${diagnostics.live.bridge_version}`
                  : "Bridge",
                icon: ArrowsLeftRight,
                ok: diagnostics?.bridge,
                detail: diagnostics?.bridge
                  ? diagnostics?.live?.bridge_version
                    ? tr("已连接 · 联动协议正常")
                    : tr("已连接 · 版本信息未提供")
                  : tr("连接不可用"),
              },
              {
                name: tr("ComfyUI 后端"),
                icon: Cpu,
                ok: diagnostics?.backend,
                detail: diagnostics?.backend
                  ? tr("在线 · 延迟 {0} ms", diagnostics.backend_latency_ms ?? tr("未知"))
                  : tr("连接不可用"),
              },
              {
                name: tr("浏览器工作流页"),
                icon: Browser,
                ok: diagnostics?.live?.pages?.some((p: BrowserPage) =>
                  p.bridges?.some(
                    (b) =>
                      b.editor_url ===
                      `http://127.0.0.1:${app.data.bridge.port}`,
                  ),
                ),
                detail:
                  diagnostics?.live?.pages?.find(
                    (p: BrowserPage) => p.client_id === client,
                  )?.workflow ||
                  diagnostics?.live?.pages?.[0]?.workflow ||
                  tr("未打开绑定工作流"),
              },
            ].map(({ name, icon: StageIcon, ok, detail }) => (
              <p key={name}>
                <StageIcon size={16} />
                <span className="chain-copy">
                  <strong>{name}</strong>
                  <small>{!diagnostics ? tr("检测中") : detail}</small>
                </span>
                {ok ? (
                  <CheckCircle
                    className="chain-ok"
                    size={16}
                    aria-label={tr("在线")}
                  />
                ) : (
                  <WarningCircle
                    className="chain-error"
                    size={16}
                    aria-label={!diagnostics ? tr("检测中") : tr("离线")}
                  />
                )}
              </p>
            ))}
          </div>
          <div className="link-memory">
            {diagnostics?.stats?.devices?.length ? (
              diagnostics.stats.devices.map((d: any, i: number) => {
                const known =
                  d.type !== "cpu" &&
                  Number.isFinite(d.vram_total) &&
                  d.vram_total > 0 &&
                  Number.isFinite(d.vram_free);
                const used = Math.max(
                  0,
                  Math.min(d.vram_total, d.vram_total - d.vram_free),
                );
                return (
                  <div key={i} title={d.name}>
                    <div className="memory-label">
                      <span>{tr("显存")}</span>
                      <span>
                        {known
                          ? `${(used / 1073741824).toFixed(2)} / ${(d.vram_total / 1073741824).toFixed(2)} GiB`
                          : tr("显存信息不可用")}
                      </span>
                    </div>
                    {known && (
                      <div
                        className="memory-track"
                        role="progressbar"
                        aria-label={tr("{0} 显存使用量", d.name)}
                        aria-valuemin={0}
                        aria-valuemax={d.vram_total}
                        aria-valuenow={used}
                      >
                        <i
                          style={{ width: `${(used / d.vram_total) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="memory-label">
                <span>{tr("显存")}</span>
                <span>{tr("显存信息不可用")}</span>
              </div>
            )}
          </div>
          <div className="queue-summary">{tr("运行中") + " "}{status.live.queue?.running.length || 0}{" " + tr("· 等待")}{" "}
            {status.live.queue?.pending.length || 0}
            <IconButton
              icon={Gear}
              label={tr("连接设置与更多选项")}
              onClick={() => setConnectionDetails((v) => !v)}
            />
          </div>
          <div className="connection-queue">
            {[
              ...(status.live.queue?.running || []),
              ...(status.live.queue?.pending || []),
            ].map((pid) => {
              const r = status.runs.find((r) => r.prompt_id === pid),
                running = status.live.queue?.running.includes(pid),
                progress = status.live.runs?.find(
                  (x) => x.request_id === r?.request_id,
                )?.progress;
              const ordinal = r ? status.runs.indexOf(r) + 1 : null;
              return (
                <div className="link-queue-row" key={pid}>
                  {running ? (
                    <SpinnerGap size={16} className="is-loading" />
                  ) : (
                    <Clock size={16} />
                  )}
                  <span className="queue-copy" title={pid}>
                    <strong>
                      {ordinal ? `#${ordinal} · ` : ""}
                      {running
                        ? `${progress?.node || tr("执行中")}${progress?.max ? ` ${progress.value || 0}/${progress.max}` : ""}`
                        : r
                          ? `${r.snapshot.generation.seed_control === "fixed" ? tr("锁定 Seed") : "Seed"} ${r.snapshot.generation.seed}`
                          : pid}
                    </strong>
                    <small>
                      {running
                        ? r
                          ? progress?.elapsed_seconds != null
                            ? tr("已运行 {0} s", Math.max(0, Math.floor(progress.elapsed_seconds)))
                            : tr("执行中 · 耗时尚未提供")
                          : tr("运行中")
                        : tr("等待 · 已锁定快照")}
                    </small>
                  </span>
                  {!running && (
                    <IconButton
                      icon={X}
                      label={tr("取消此任务")}
                      onClick={() => void queueAction("cancel", pid)}
                    />
                  )}
                </div>
              );
            })}
            {!status.live.queue?.running.length &&
              !status.live.queue?.pending.length && (
                <p className="hint">{tr("队列空闲")}</p>
              )}
          </div>
          {connectionDetails && (
            <section className="connection-details">
              {browserSelect}
              {status.runs
                .filter((run) => run.status === "queued")
                .slice(-1)
                .map((run) => (
                  <section
                    className="locked-snapshot-note"
                    key={run.request_id}
                  >
                    <strong>{tr("排队任务已锁定快照")}</strong>
                    <p>{tr("排队快照 · Seed") + " "}{run.snapshot.generation.seed}</p>
                    <p>{tr("当前编辑 ·")}{" "}
                      {changes(run.state, app.data.project.State).length}{" "}{tr("处差异，不影响排队任务")}</p>
                    <details>
                      <summary>{tr("查看排队快照")}</summary>
                      <p>{tr("积极提示词")}</p>
                      <pre>{run.state.Positive.Text || tr("无")}</pre>
                      <p>{tr("消极提示词")}</p>
                      <pre>{run.state.Negative.Text || tr("无")}</pre>
                    </details>
                    <button onClick={() => setConnection(false)}>{tr("继续编辑")}</button>
                  </section>
                ))}
              <div className="inline-actions">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(app.data.bridge.comfyUrl)
                      .then(() => app.notify(tr("已复制工作流页地址")))
                  }
                >{tr("复制地址")}</button>
                <IconButton
                  icon={ArrowsClockwise}
                  label={tr("重新诊断连接与显存")}
                  onClick={() => void diagnose()}
                />
                <button
                  onClick={() => {
                    setConnection(false);
                    app.open("generation");
                  }}
                >{tr("连接设置")}</button>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={!!app.data.settings.GenerationNotifications}
                  onChange={(e) =>
                    void app.act("settings.set", {
                      value: {
                        ...app.data.settings,
                        GenerationNotifications: e.target.checked,
                      },
                    })
                  }
                />{tr("窗口失焦时发送 Windows 完成通知")}</label>
              <p className="hint">{tr("显存释放为异步请求；未知受理任务需先核对队列。")}</p>
            </section>
          )}
          {(diagnostics?.bridge_error || diagnostics?.backend_error) && (
            <p role="alert" className="connection-error">
              {diagnostics.bridge_error || diagnostics.backend_error}
            </p>
          )}
          <div className="inline-actions">
            <button
              onClick={() => {
                setConnection(false);
                app.open("runs");
              }}
            >{tr("查看生成记录")}</button>
          </div>
          {status.runs
            .filter(
              (r) => r.server_url === app.data.bridge.comfyUrl && unresolved(r),
            )
            .map((r) => (
              <p role="status" key={r.request_id}>
                {r.error || tr("等待浏览器受理；请核对队列和历史，不会自动重提。")}
              </p>
            ))}
        </Modal>
      )}
      {check && (
        <Modal
          icon={WarningCircle}
          title={
            !check.issues.length
              ? tr("提交前体检通过")
              : check.issues.some((issue) => issue.blocking)
                ? tr("生成前需要处理 {0} 个问题", check.issues.length)
                : tr("生成前有 {0} 项建议关注", check.issues.length)
          }
          subtitle={tr("解决问题后重新检查")}
          width={584}
          className="link-preflight"
          onClose={() => setCheck(null)}
          footer={
            <>
              <button onClick={() => setCheck(null)}>{tr("取消")}</button>
              <span className="spacer" />
              <button onClick={() => void recheck()}>{tr("重新检查")}</button>
              <button
                className="primary"
                disabled={busy || check.issues.some((i) => i.blocking)}
                onClick={() => void submit(options)}
              >{tr("仍然生成")}</button>
            </>
          }
        >
          {(check.pages?.length || 0) > 1 && browserSelect}
          {check.issues.map((issue, i) => (
            <div className="preflight-issue" key={i}>
              <span className={`issue-kind ${issue.blocking ? "" : "warning"}`}>
                {issue.blocking ? tr("阻断") : tr("建议")}
              </span>
              <div>
                <strong>{trDiagnostic(issue.message)}</strong>
                <p className="preflight-reason">
                  {issue.kind === "lora"
                    ? tr("文件可能已移动或重命名，替换后重新生成。")
                    : issue.kind === "parameters"
                      ? tr("建议调整为有效范围内的 8 的倍数。")
                      : issue.kind === "group"
                        ? tr("同步目标仅作用于当前项目的此分组。")
                        : tr("打开绑定的工作流，并保持页面在线。")}
                </p>
              </div>
              {issue.kind === "group" && issue.options?.length ? (
                <button
                  onClick={() => {
                    setMapping(issue);
                    setMappingTarget("");
                  }}
                >{tr("选择同步目标")}</button>
              ) : issue.kind === "browser" || issue.kind === "connection" ? (
                <button
                  onClick={() =>
                    void openExternal(app.data.bridge.comfyUrl).catch((e) =>
                      app.reportError(String(e)),
                    )
                  }
                >{tr("打开页面")}</button>
              ) : issue.kind === "lora" ? (
                <button
                  onClick={() => {
                    setCheck(null);
                    app.open("models");
                  }}
                >{tr("替换 LoRA")}</button>
              ) : issue.kind === "parameters" ? (
                <button
                  onClick={async () => {
                    if (
                      /宽高/.test(issue.message) &&
                      app.draftRepairs.current.has("generation.size")
                    ) {
                      try {
                        await app.draftRepairs.current.get(
                          "generation.size",
                        )!();
                        await recheck();
                      } catch (e) {
                        app.reportError(String(e));
                      }
                      return;
                    }
                    setCheck(null);
                    app.open("generation");
                  }}
                >
                  {/宽高/.test(issue.message) ? tr("调整尺寸") : tr("调整参数")}
                </button>
              ) : null}
            </div>
          ))}
          {!check.issues.length ? (
            <p>{tr("体检通过，可以生成。")}</p>
          ) : (
            <p className="preflight-summary">{tr("阻断问题") + " "}{check.issues.filter((i) => i.blocking).length}{" " + tr("项 ·")}{" "}
              {check.issues.some((i) => i.blocking)
                ? tr("当前无法提交")
                : tr("仅建议，可继续生成")}
            </p>
          )}
        </Modal>
      )}
      {mapping && (
        <Modal
          title={tr("{0} 对应多个工作流分组", mapping.name)}
          className="group-mapping-dialog"
          width={936}
          subtitle={tr("选择当前项目的同步目标，避免提示词写入错误分组。")}
          onClose={() => setMapping(null)}
          footer={
            <>
              <button
                onClick={async () => {
                  try {
                    await flush();
                    await poll();
                    const next = await rpc<Check>("runs.preflight", {
                      ...options,
                      client_id: client,
                    });
                    setCheck(next);
                    const updated = next.issues.find(
                      (i) => i.kind === "group" && i.name === mapping.name,
                    );
                    setMapping(updated || null);
                    if (
                      !updated?.options?.some(
                        (o) => o.bypasser_id === mappingTarget,
                      )
                    )
                      setMappingTarget("");
                  } catch (e) {
                    app.reportError(String(e));
                  }
                }}
              >{tr("刷新目录")}</button>
              <span className="spacer" />
              <button onClick={() => setMapping(null)}>{tr("返回体检")}</button>
              <button
                className="primary"
                disabled={!mappingTarget || busy}
                onClick={async () => {
                  try {
                    await app.act("runs.map", {
                      name: mapping.name,
                      target: mappingTarget,
                    });
                    await recheck();
                    setMapping(null);
                  } catch (e) {
                    app.reportError(String(e));
                  }
                }}
              >{tr("保存映射并重检")}</button>
            </>
          }
        >
          <div
            className="group-mapping-list"
            role="listbox"
            aria-label={tr("工作流同步目标")}
          >
            {mapping.options?.map((g) => (
              <button
                role="option"
                aria-selected={mappingTarget === g.bypasser_id}
                key={g.bypasser_id}
                className={mappingTarget === g.bypasser_id ? "selected" : ""}
                onClick={() => setMappingTarget(g.bypasser_id)}
              >
                {g.name}{" " + tr("· 节点 #")}{g.bypasser_id}
                {g.title || g.description
                  ? ` · ${g.title || g.description}`
                  : ""}
              </button>
            ))}
          </div>
          <p className="hint">{tr("映射范围：当前项目 ·") + " "}{mapping.name}{" " + tr("组")}</p>
          <p className="hint">{tr("刷新目录后保留有效映射；找不到目标时需重新选择。")}</p>
        </Modal>
      )}
      {selected && (
        <Modal
          title={diff ? tr("只取这张图的部分差异") : tr("生成结果与提示词版本")}
          subtitle={
            diff ? tr("当前编辑 → 目标图 · Ctrl / Shift 多选要应用的行") : undefined
          }
          width={diff ? 936 : 1600}
          className={diff ? "link-difference-picker" : "run-detail-dialog"}
          onClose={() => {
            setSelected(null);
            setDiff(null);
          }}
          footer={
            diff ? (
              <>
                <button
                  onClick={() => setSelectedRows(diff.rows.map((r) => r.id))}
                >{tr("全选")}</button>
                <button
                  disabled={!selectedRows.length}
                  onClick={() => setSelectedRows([])}
                >{tr("清空")}</button>
                <span className="spacer" />
                <button
                  onClick={() => {
                    setDiff(null);
                    setSelected(null);
                  }}
                >{tr("取消")}</button>
                <button disabled={applyBusy} onClick={() => void apply(true)}>{tr("应用完整参数…")}</button>
                <button
                  className="primary"
                  disabled={applyBusy || !selectedRows.length}
                  onClick={() => void apply(false)}
                >{tr("应用") + " "}{selectedRows.length}{" " + tr("项差异")}</button>
              </>
            ) : (
              <>
                <span
                  className="hint"
                  aria-label={tr("大图记录位置")}
                  aria-live="polite"
                >
                  {resultPosition >= 0
                    ? `${resultPosition + 1} / ${navigable.length}`
                    : tr("当前记录")}
                </span>
                <button onClick={() => setSelected(null)}>{tr("关闭")}</button>
                <button
                  aria-expanded={resultDetails}
                  onClick={() => setResultDetails((v) => !v)}
                >
                  {resultDetails ? tr("收起详情") : tr("显示详情")}
                </button>
                <span className="spacer" />
                <button
                  onClick={() =>
                    void loadDiff(selected.run).catch((e) =>
                      app.reportError(String(e)),
                    )
                  }
                >{tr("只取差异…")}</button>
                <button
                  className="primary"
                  disabled={applyBusy}
                  onClick={() =>
                    void restoreVersion(selected.run).catch(() => {})
                  }
                >{tr("回到此版本")}</button>
              </>
            )
          }
        >
          {diff ? (
            <>
              <div
                className="link-diff-table"
                role="listbox"
                aria-label={tr("选择提示词与参数差异")}
                aria-multiselectable="true"
              >
                <div className="link-diff-header">
                  <span>{tr("提示词 / 参数")}</span>
                  <span>{tr("当前")}</span>
                  <span>{tr("应用后")}</span>
                </div>
                {diff.rows.map((row, i) => (
                  <button
                    role="option"
                    aria-selected={selectedRows.includes(row.id)}
                    key={row.id}
                    className={`link-diff-row ${selectedRows.includes(row.id) ? "selected" : ""}`}
                    onClick={(e) => {
                      if (e.shiftKey) {
                        const range = diff.rows
                          .slice(
                            Math.min(lastRow.current, i),
                            Math.max(lastRow.current, i) + 1,
                          )
                          .map((r) => r.id);
                        setSelectedRows((v) => [...new Set([...v, ...range])]);
                      } else
                        setSelectedRows((v) =>
                          e.ctrlKey || e.metaKey
                            ? v.includes(row.id)
                              ? v.filter((id) => id !== row.id)
                              : [...v, row.id]
                            : v.length === 1 && v[0] === row.id
                              ? []
                              : [row.id],
                        );
                      lastRow.current = i;
                    }}
                  >
                    <span>
                      {row.side === "negative" ? tr("消极 · ") : ""}
                      {tr(row.label)}
                    </span>
                    <span>{row.from || tr("无")}</span>
                    <span>
                      {!row.to
                        ? tr("移除")
                        : !row.from
                          ? tr("恢复 · {0}", row.to_weight != null ? Number(row.to_weight).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 10, useGrouping: false }) : row.to)
                          : row.to}
                    </span>
                  </button>
                ))}
              </div>
              <p className="hint">{tr("已选") + " "}{selectedRows.length}{" " + tr("项 · 其他提示词与参数保持当前值。应用失败时整笔回滚。")}</p>
            </>
          ) : (
            <>
              <div
                className="run-diff-direction"
                aria-label={tr("对比方向：这张图的快照到当前编辑")}
              >
                <ArrowsLeftRight size={16} aria-hidden="true" />
                <span className="direction-label">{tr("对比方向")}</span>
                <span className="direction-source">{tr("这张图的快照")}</span>
                <ArrowRight size={14} aria-hidden="true" />
                <span>{tr("当前编辑")}</span>
              </div>
              <div
                className={`run-detail ${resultDetails ? "with-details" : ""}`}
              >
                <div className="run-detail-image">
                  <ResultViewport
                    key={`${selected.run.request_id}/${selected.index}`}
                    width={selected.run.snapshot.generation.width}
                    height={selected.run.snapshot.generation.height}
                    overlay={
                      <>
                        <button
                          className="result-navigation previous"
                          aria-label={tr("上一条记录 · ←")}
                          disabled={applyBusy || resultPosition <= 0}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={() => moveResult(-1)}
                        >
                          <ArrowLeft size={28} aria-hidden="true" />
                        </button>
                        <button
                          className="result-navigation next"
                          aria-label={tr("下一条记录 · →")}
                          disabled={
                            applyBusy ||
                            resultPosition < 0 ||
                            resultPosition >= navigable.length - 1
                          }
                          onPointerDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={() => moveResult(1)}
                        >
                          <ArrowRight size={28} aria-hidden="true" />
                        </button>
                      </>
                    }
                  >
                    {(style) => (
                      <ResultImagePlane style={style}>
                        <ResultImage
                          run={selected.run}
                          index={selected.index}
                          full
                        />
                      </ResultImagePlane>
                    )}
                  </ResultViewport>
                </div>
                <aside hidden={!resultDetails}>
                  <div className="run-image-actions" aria-label={tr("图片快捷操作")}>
                    {imageActions(selected.run, selected.index).map((item) => (
                      <IconButton
                        key={item.label}
                        icon={item.icon}
                        label={item.label}
                        disabled={item.disabled}
                        onClick={() => void item.action()}
                      />
                    ))}
                  </div>
                  <MiddleEllipsis
                    className="run-filename hint"
                    text={selected.run.outputs[selected.index]?.filename || ""}
                  />
                  <strong>
                    {new Date(selected.run.created).toLocaleString(getLocale())}
                  </strong>
                  <p>Seed {selected.run.snapshot.generation.seed}</p>
                  <p>
                    {selected.run.snapshot.generation.width} ×{" "}
                    {selected.run.snapshot.generation.height} ·{" "}
                    {selected.run.snapshot.generation.steps} Steps
                  </p>
                  <DiffBadges run={selected.run} all />
                  <p className="hint">{tr("恢复完整参数以一次事务应用，可 Ctrl+Z 撤销。")}</p>
                </aside>
              </div>
            </>
          )}
        </Modal>
      )}
    </Link.Provider>
  );
}
function SnapshotBeforeApply({
  busy,
  onClose,
  onSave,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  const save = async () => {
    if (!name.trim() || saving.current || busy) return;
    saving.current = true;
    try {
      await onSave(name.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      saving.current = false;
    }
  };
  return (
    <Modal
      title={tr("保存快照后应用参数")}
      width={600}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button disabled={busy} onClick={onClose}>{tr("取消")}</button>
          <button
            className="primary"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >{tr("保存快照并应用")}</button>
        </>
      }
    >
      <p>{tr("将完整保存当前项目，再恢复目标记录的提示词、分组和生成参数。")}</p>
      <label className="snapshot-name-field">{tr("快照名称")}<input
          autoFocus
          aria-label={tr("快照名称")}
          value={name}
          disabled={busy}
          placeholder={tr("输入快照名称（必填）")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}

function FilmDifferences({ run, index }: { run: Run; index: number }) {
  const app = useApp(),
    link = useLink();
  const root = useRef<HTMLDivElement>(null),
    measure = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ height: 0, width: 0 }),
    [visible, setVisible] = useState(3);
  const available = Math.max(0, space.height - 28);
  const positive = changes(run.state, app.data.project.State, "Positive");
  const parameters = [
    ...parameterChanges(run.snapshot.generation, app.data.generation),
    ...mappingChanges(
      run.snapshot.comfy_group_targets,
      app.data.project.ComfyGroupTargets,
    ),
  ].filter((r) => r.label !== "Seed");
  const negative = changes(run.state, app.data.project.State, "Negative");
  const prompts = positive.map((text) => ({ text, kind: "prompt" }));
  const other = parameters.map((r) => ({ text: r.text, kind: "parameter" }));
  const rest = negative.map((text) => ({
    text: tr("消极 · {0}", text),
    kind: "parameter",
  }));
  const all = [...prompts, ...other, ...rest];
  const candidates =
    available < 115
      ? prompts
      : [...prompts.slice(0, 3), ...other, ...prompts.slice(3), ...rest];
  const signature = JSON.stringify(candidates);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const resize = () =>
      setSpace((previous) =>
        previous.height === el.clientHeight && previous.width === el.clientWidth
          ? previous
          : { height: el.clientHeight, width: el.clientWidth },
      );
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    const children = Array.from(el.children) as HTMLElement[];
    const top = el.getBoundingClientRect().top;
    const fits = children.every(
      (child) => child.getBoundingClientRect().bottom - top <= available,
    );
    const budget = Math.max(
      0,
      available - (fits && candidates.length === all.length ? 0 : 24),
    );
    let count = 0;
    for (const child of children) {
      if (child.getBoundingClientRect().bottom - top > budget) break;
      count++;
    }
    setVisible(count);
  }, [signature, available, space.width, all.length]);
  const copy = async (seed = false) => {
    try {
      const text = seed
        ? String(run.snapshot.generation.seed)
        : await rpc<string>("runs.prompt", { request_id: run.request_id });
      await navigator.clipboard.writeText(text);
      app.notify(seed ? tr("Seed 已复制") : tr("目标图像的完整积极提示词已复制"));
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const style = (text: string) =>
    text.startsWith("+")
      ? "added"
      : text.startsWith("−")
        ? "removed"
        : "changed";
  const hidden = all.length - Math.min(visible, candidates.length);
  return (
    <div
      className="film-info"
      ref={root}
      aria-label={tr("生成参数差异")}
      onContextMenu={(e) => {
        e.preventDefault();
        link.parameterMenu(run, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          link.parameterMenu(run, rect.left, rect.top);
        }
      }}
    >
      <div className="film-info-content">
        <button
          className="film-seed"
          title={tr("复制 Seed 数值")}
          onClick={() => void copy(true)}
        >
          Seed {run.snapshot.generation.seed}
        </button>
        <div className="film-diff-area">
          <div
            className="diff-badges film-diff-measure"
            ref={measure}
            aria-hidden="true"
          >
            {candidates.map((r, i) => (
              <small key={i} className={style(r.text)}>
                {r.text}
              </small>
            ))}
          </div>
          <div className="diff-badges film-visible-diffs">
            {candidates.slice(0, visible).map((r, i) => (
              <button
                key={i}
                className={style(r.text)}
                title={
                  r.kind === "prompt"
                    ? tr("复制目标图像的完整积极提示词")
                    : r.text + tr(" · 选择导入参数")
                }
                onClick={() =>
                  r.kind === "prompt" ? void copy() : void link.pick(run, index)
                }
              >
                {r.text}
              </button>
            ))}
            {hidden > 0 && (
              <button
                className="film-more"
                title={tr("查看全部提示词与参数差异")}
                onClick={() => void link.pick(run, index)}
              >
                +{hidden}
              </button>
            )}
            {!all.length && (
              <button onClick={() => void link.pick(run, index)}>{tr("与当前参数相同")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DiffBadges({
  run,
  all = false,
  limit = 3,
}: {
  run: Run;
  all?: boolean;
  limit?: number;
}) {
  const app = useApp();
  const prompts = changes(run.state, app.data.project.State);
  const parameters = [
    ...parameterChanges(run.snapshot.generation, app.data.generation).map(
      (r) => r.text,
    ),
    ...mappingChanges(
      run.snapshot.comfy_group_targets,
      app.data.project.ComfyGroupTargets,
    ).map((r) => r.text),
  ];
  const rows = all
    ? [...prompts, ...parameters]
    : [
        ...prompts.slice(0, 1),
        ...parameters.filter((row) => !row.startsWith("Seed ")),
        ...prompts.slice(1),
        ...parameters.filter((row) => row.startsWith("Seed ")),
      ];
  return (
    <div className="diff-badges" title={rows.join("\n") || tr("与当前参数相同")}>
      {(all ? rows : rows.slice(0, limit)).map((s, i) => (
        <small
          className={
            s.startsWith("+")
              ? "added"
              : s.startsWith("−")
                ? "removed"
                : "changed"
          }
          key={i}
        >
          {s}
        </small>
      ))}
      {!all && rows.length > limit && <small>+{rows.length - limit}</small>}
      {!rows.length && <small>{tr("与当前参数相同")}</small>}
    </div>
  );
}
export function GenerateButton() {
  const link = useLink(),
    app = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [batch, setBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(4);
  const checkingVisible = link.checking;
  const [completed, setCompleted] = useState(false);
  const knownStates = useRef(new Map<string, string>());
  const completionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => {
    const finished = link.status.runs.some(
      (r) =>
        r.status === "completed" &&
        ["running", "queued", "dispatching", "claimed"].includes(
          knownStates.current.get(r.request_id) || "",
        ),
    );
    knownStates.current = new Map(
      link.status.runs.map((r) => [r.request_id, r.status]),
    );
    if (finished) {
      setCompleted(true);
      clearTimeout(completionTimer.current);
      completionTimer.current = setTimeout(() => setCompleted(false), 800);
    }
  }, [link.status.runs]);
  useEffect(() => () => clearTimeout(completionTimer.current), []);
  const latest = link.status.runs
      .filter(
        (r) =>
          r.prompt_id &&
          belongsToProject(
            r,
            app.data.project,
            app.data.projectPath,
            link.status.session_id,
          ),
      )
      .at(-1),
    running = link.status.runs.find((r) => r.status === "running");
  const progress = link.status.live.runs?.find(
    (r) => r.request_id === running?.request_id,
  )?.progress;
  const latestChanges = latest
    ? [
        ...changes(latest.state, app.data.project.State),
        ...parameterChanges(
          latest.snapshot.generation,
          app.data.generation,
        ).map((r) => r.text),
        ...mappingChanges(
          latest.snapshot.comfy_group_targets,
          app.data.project.ComfyGroupTargets,
        ).map((r) => r.text),
      ]
    : [];
  const pending = link.status.runs.some(unresolved),
    count = latestChanges.length;
  const queued = link.status.runs.filter((r) => r.status === "queued").length;
  const offline =
    !!link.error ||
    !link.status.live.pages?.some((p) =>
      p.bridges.some(
        (b) => b.editor_url === `http://127.0.0.1:${app.data.bridge.port}`,
      ),
    );
  const tip = useTooltip(
    <div className="generate-diff-content">
      <strong>
        {offline
          ? tr("浏览器工作流未连接 · 点击查看连接链路")
          : count
            ? tr("自上次生成以来 · {0} 处改动", count)
            : latest
              ? tr("与上次生成相同，将按 Seed 控制方式生成")
              : tr("生成 · Ctrl+Enter")}
      </strong>
      {!offline &&
        latest &&
        latestChanges.map((s, i) => (
          <span
            key={i}
            className={
              s.startsWith("+")
                ? "added"
                : s.startsWith("−")
                  ? "removed"
                  : "changed"
            }
          >
            {s}
          </span>
        ))}
    </div>,
  );
  return (
    <div className="generate-split">
      <button
        className={`primary generate-main ${offline ? "offline" : ""}`}
        aria-label={tr("生成 · Ctrl+Enter")}
        aria-disabled={link.busy}
        aria-busy={link.busy}
        data-offline={offline}
        data-pending={pending}
        aria-describedby={tip.describedBy}
        onPointerEnter={tip.show}
        onPointerLeave={tip.leave}
        onFocus={tip.focus}
        onBlur={tip.hide}
        onClick={() => {
          tip.hide();
          offline ? link.connect() : void link.submit();
        }}
      >
        {checkingVisible ? (
          <SpinnerGap size={16} className="is-loading" />
        ) : completed ? (
          <CheckCircle size={16} />
        ) : (
          <Play size={16} />
        )}
        <span>
          {checkingVisible
            ? tr("体检中")
            : completed
              ? tr("已完成")
              : pending
                ? tr("待确认")
                : progress?.max
                  ? `${progress.value || 0} / ${progress.max}`
                  : running
                    ? tr("生成中")
                    : queued
                      ? tr("排队 {0}", queued)
                      : tr("生成")}
        </span>
        {count > 0 && <small className="change-count">{count}</small>}
        {!!progress?.max && (
          <i
            className="generate-button-progress"
            style={{
              width: `${Math.max(0, Math.min(100, ((progress.value || 0) / progress.max) * 100))}%`,
            }}
          />
        )}
      </button>
      {tip.tooltip}
      <IconButton
        icon={CaretDown}
        className="primary"
        label={tr("生成选项")}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.right - 240, y: r.bottom + 8 });
        }}
      />
      {menu && (
        <Menu
          {...menu}
          onClose={() => setMenu(null)}
          items={[
            {
              label: tr("生成"),
              icon: Play,
              shortcut: "Ctrl+Enter",
              action: () => link.submit(),
            },
            { label: tr("生成 ×N…"), icon: Stack, action: () => setBatch(true) },
            {
              label: tr("锁定 Seed 重跑"),
              icon: Lock,
              shortcut: "Ctrl+Shift+Enter",
              action: () => link.submit({ lock_seed: true }),
            },
            {
              label: tr("仅提交消极词修改"),
              icon: TextT,
              disabled: !latest,
              action: () => link.submit({ mode: "negative" }),
            },
            { separator: true, label: "" },
            {
              label: tr("中断当前任务…"),
              icon: StopCircle,
              shortcut: "Ctrl+.",
              disabled: !link.status.live.queue?.running.length,
              action: () => link.queueAction("interrupt"),
            },
            {
              label: tr("清空等待队列（保留当前任务）…"),
              icon: Trash,
              disabled: !link.status.live.queue?.pending.length,
              action: () => link.queueAction("clear"),
            },
            { label: tr("连接与队列…"), action: link.connect },
            {
              label: link.film ? tr("折叠结果胶片条") : tr("展开结果胶片条"),
              shortcut: "Ctrl+J",
              action: link.toggleFilm,
            },
          ]}
        />
      )}
      {batch && (
        <Modal
          title={tr("批量生成")}
          width={400}
          onClose={() => setBatch(false)}
          footer={
            <>
              <button onClick={() => setBatch(false)}>{tr("取消")}</button>
              <span className="spacer" />
              <button
                className="primary"
                disabled={
                  !Number.isInteger(batchCount) ||
                  batchCount < 1 ||
                  batchCount > 16
                }
                onClick={() => {
                  setBatch(false);
                  void link.submit({ count: batchCount });
                }}
              >{tr("生成 ×")}{batchCount || "N"}
              </button>
            </>
          }
        >
          <label>{tr("任务数")}<input
              type="number"
              aria-label={tr("批量任务数")}
              min={1}
              max={16}
              value={batchCount || ""}
              onChange={(e) => setBatchCount(Number(e.target.value))}
            />
          </label>
          <p>{tr("一次锁定同一版提示词，每个任务保存独立快照，Seed 沿用当前控制方式。")}</p>
        </Modal>
      )}
    </div>
  );
}
export function ComfyConnectionCard() {
  const link = useLink();
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(
    null,
  );
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };
  const hide = () => {
    cancelHide();
    hoverTimer.current = setTimeout(() => setAnchor(null), 150);
  };
  useEffect(() => {
    const close = () => setAnchor(null);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
      cancelHide();
    };
  }, []);
  const run = link.status.runs.find((r) => r.status === "running");
  const p = link.status.live.runs?.find(
    (r) => r.request_id === run?.request_id,
  )?.progress;
  const percent = link.error
    ? "—"
    : run
      ? p?.max && Number.isFinite(p.value)
        ? `${Math.max(0, Math.min(100, Math.floor((p.value! / p.max) * 100)))}%`
        : "—%"
      : "0%";
  const content = (
    <>
      <span>
        <i className={`status-dot ${link.error ? "failed" : ""}`} />
        ComfyUI
      </span>
      <CaretRight size={16} />
      {p?.preview && /^data:image\/(jpeg|png|webp);base64,/.test(p.preview) && (
        <img className="live-preview" alt={tr("去噪预览")} src={p.preview} />
      )}
      <small>
        {link.error
          ? tr("连接失败 · 点击查看")
          : run
            ? tr("节点 {0}", p?.node || tr("执行中"))
            : tr("连接与队列")}
      </small>
      {p?.max ? (
        <>
          <small>
            {p.value || 0} / {p.max}
            {p.remaining_seconds != null
              ? tr(" · 约 {0} s", p.remaining_seconds)
              : ""}
          </small>
          <progress max={p.max} value={p.value || 0} />
        </>
      ) : null}
      <small>{tr("排队") + " "}{link.status.live.queue?.pending.length || 0}{" " + tr("· 已锁定提交快照")}</small>
    </>
  );
  return (
    <>
      <button
        className="comfy-progress-button"
        aria-label={tr("ComfyUI 生成进度 {0} · 点击查看连接与队列", percent)}
        aria-describedby={anchor ? tooltipId : undefined}
        aria-haspopup="dialog"
        onPointerEnter={(e) => {
          cancelHide();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({
            left: Math.min(rect.right + 8, window.innerWidth - 296),
            bottom: Math.max(16, window.innerHeight - rect.bottom),
          });
        }}
        onPointerLeave={hide}
        onFocus={(e) => {
          cancelHide();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({
            left: Math.min(rect.right + 8, window.innerWidth - 296),
            bottom: Math.max(16, window.innerHeight - rect.bottom),
          });
        }}
        onBlur={() => {
          cancelHide();
          setAnchor(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setAnchor(null);
          }
        }}
        onClick={() => {
          cancelHide();
          setAnchor(null);
          link.connect();
        }}
      >
        {percent}
        <i className={`status-dot ${link.error ? "failed" : ""}`} />
      </button>
      {anchor &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="connection-card comfy-status-popover"
            style={{ left: anchor.left, bottom: anchor.bottom }}
            onPointerEnter={cancelHide}
            onPointerLeave={hide}
          >
            {content}
          </div>,
          document.body,
        )}
      <button
        className="connection-card comfy-connection-card"
        onClick={link.connect}
      >
        {content}
      </button>
    </>
  );
}
export function GenerationProgress() {
  const link = useLink();
  const r = link.status.runs.find((r) => r.status === "running");
  const p = link.status.live.runs?.find(
    (v) => v.request_id === r?.request_id,
  )?.progress;
  return (
    <div
      className="generation-progress"
      role="progressbar"
      aria-label={tr("生成进度")}
      aria-valuenow={p?.value || 0}
      aria-valuemax={p?.max || 100}
    >
      <i
        style={{
          width: r
            ? `${p?.max ? Math.min(100, ((p.value || 0) / p.max) * 100) : 5}%`
            : "0%",
        }}
      />
    </div>
  );
}
// Keep at least 340px for the workbench and cap the strip at 40% of the viewport.
function filmMaximum() {
  return Math.max(
    112,
    Math.min(
      360,
      Math.floor(window.innerHeight * 0.4),
      window.innerHeight - 340,
    ),
  );
}
export function ResultFilmstrip() {
  const link = useLink();
  const app = useApp();
  const [clearing, setClearing] = useState(false);
  const clearGate = useRef(false);
  const runs = link.status.runs.filter(
    (run) =>
      !run.film_hidden &&
      belongsToProject(
        run,
        app.data.project,
        app.data.projectPath,
        link.status.session_id,
      ),
  );
  const removable = runs.filter((run) =>
    ["cancelled", "failed"].includes(run.status),
  ).length;
  async function clearInactive() {
    if (clearGate.current) return;
    clearGate.current = true;
    setClearing(true);
    try {
      const result = await rpc<{ cleared: number }>("runs.clear_inactive");
      await link.poll();
      app.notify(tr("已从胶片条清除 {0} 项，记录与图片保留", result.cleared));
    } catch (e) {
      app.reportError(String(e));
    } finally {
      clearGate.current = false;
      setClearing(false);
    }
  }
  const results = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem("comfy-film-height"));
    return Number.isFinite(saved) && saved >= 96 ? Math.min(360, saved) : 112;
  });
  const [maximum, setMaximum] = useState(filmMaximum);
  const filmHeight = Math.min(height, maximum);
  const resize = (value: number) =>
    setHeight(Math.round(Math.max(96, Math.min(maximum, value))));
  const hasRuns = runs.length > 0;
  useEffect(() => {
    const update = () => setMaximum(filmMaximum());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    localStorage.setItem("comfy-film-height", String(height));
  }, [height]);
  useEffect(() => {
    const element = results.current;
    if (!element) return;
    return attachFilmScrolling(element);
  }, [link.film, hasRuns]);
  if (!hasRuns) return null;
  if (!link.film)
    return (
      <button className="film-collapsed" onClick={link.toggleFilm}>
        <Images size={16} />{tr("生成结果 ·") + " "}{runs.reduce((n, r) => n + r.outputs.length, 0)}
        <CaretUp size={16} />
      </button>
    );
  return (
    <section
      className="result-filmstrip"
      aria-label={tr("生成结果胶片条")}
      style={{ "--film-requested-height": `${filmHeight}px` } as CSSProperties}
    >
      <div
        className="film-resize-handle"
        role="separator"
        aria-label={tr("调整结果胶片条高度")}
        aria-orientation="horizontal"
        aria-valuemin={96}
        aria-valuemax={maximum}
        aria-valuenow={filmHeight}
        tabIndex={0}
        title={tr("拖动调节胶片条高度 · ↑/↓ 调整 · 双击或 Home 还原")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height: filmHeight };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            resize(drag.current.height + drag.current.y - event.clientY);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onDoubleClick={() => resize(112)}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          resize(
            event.key === "Home"
              ? 112
              : event.key === "End"
                ? maximum
                : filmHeight + (event.key === "ArrowUp" ? 16 : -16),
          );
        }}
      />
      <div className="film-caption">
        <div className="film-summary">
          <div className="film-summary-title">
            <span>{tr("当前项目")}</span>
            <IconButton
              icon={Images}
              label={tr("查看生成记录")}
              onClick={() => app.open("runs")}
            />
          </div>
          <small>{runs.reduce((n, r) => n + r.outputs.length, 0)}{" " + tr("张结果")}</small>
        </div>
        <div className="film-actions">
          <IconButton
            icon={Broom}
            label={tr("清除已取消和生成失败项")}
            disabled={clearing || !removable}
            onClick={() => void clearInactive()}
          />
          <IconButton
            icon={CaretDown}
            label={tr("折叠结果胶片条 · Ctrl+J")}
            onClick={link.toggleFilm}
          />
          <IconButton
            icon={Trash}
            label={tr("清空等待队列（保留当前任务）")}
            disabled={!link.status.live.queue?.pending.length}
            onClick={() => void link.queueAction("clear")}
          />
        </div>
      </div>
      <div
        className="film-results"
        ref={results}
        aria-label={tr("按住鼠标左右拖动浏览，松手惯性减速；也可使用滚轮")}
      >
        {runs
          .slice()
          .reverse()
          .map((run) =>
            run.outputs.length ? (
              run.outputs.map((o, i) => (
                <div
                  className="film-result"
                  key={
                    run.request_id +
                    "/" +
                    o.node_id +
                    "/" +
                    o.filename +
                    "/" +
                    i
                  }
                >
                  <button
                    className="film-image-hit"
                    aria-label={
                      tr("查看大图 · Seed ") + run.snapshot.generation.seed
                    }
                    onClick={() =>
                      link.inspect(
                        run,
                        i,
                        runs
                          .slice()
                          .reverse()
                          .flatMap((r) =>
                            r.outputs.map((_, index) => ({ run: r, index })),
                          ),
                      )
                    }
                    title={tr("点击查看大图 · 右键打开图片操作菜单")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      link.imageMenu(run, i, e.clientX, e.clientY);
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.key === "ContextMenu" ||
                        (e.shiftKey && e.key === "F10")
                      ) {
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        link.imageMenu(run, i, rect.left, rect.top);
                      }
                    }}
                  >
                    <ResultImage run={run} index={i} />
                  </button>
                  <FilmDifferences run={run} index={i} />
                </div>
              ))
            ) : (
              <button
                className={`film-result placeholder ${active(run) ? "in-progress" : ""}`}
                key={run.request_id}
                onClick={link.connect}
              >
                <span className="result-placeholder">
                  {active(run) && run.status !== "unknown" ? (
                    <SpinnerGap
                      size={28}
                      className="film-status-icon is-loading"
                      aria-hidden="true"
                    />
                  ) : (
                    <WarningCircle
                      size={28}
                      className="film-status-icon"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <div>
                  <strong>{tr(labels[run.status] || "") || run.status}</strong>
                  <FilmRunProgress run={run} />
                </div>
              </button>
            ),
          )}
      </div>
    </section>
  );
}
function FilmRunProgress({ run }: { run: Run }) {
  const p = useLink().status.live.runs?.find(
    (r) => r.request_id === run.request_id,
  )?.progress;
  return (
    <>
      <small>
        {p?.max
          ? tr("{0} / {1} · 快照已锁定", p.value || 0, p.max)
          : run.error || tr("提示词快照已锁定")}
      </small>
      {!!p?.max && (
        <progress
          className="film-node-progress"
          aria-label={tr("当前任务节点进度")}
          value={p.value || 0}
          max={p.max}
        />
      )}
    </>
  );
}
