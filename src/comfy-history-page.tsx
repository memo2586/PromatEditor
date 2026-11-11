import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { belongsToProject } from "./parameter-diff";
import {
  ArrowsLeftRight,
  FolderOpen,
  Flask,
  Funnel,
  MagnifyingGlass,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { useApp } from "./context";
import { IconButton } from "./ui";
import { SearchableSelect } from "./searchable-select";

function latestOptions(runs: Run[], key: (run: Run) => string) {
  const time = (run: Run) => Date.parse(run.created) || 0;
  const latest = new Map<string, Run>();
  for (const run of runs) {
    const id = key(run),
      previous = latest.get(id);
    if (!previous || time(run) > time(previous)) latest.set(id, run);
  }
  return [...latest.entries()].sort(
    (a, b) => time(b[1]) - time(a[1]) || a[0].localeCompare(b[0]),
  );
}
import {
  useLink,
  ResultImage,
  DiffBadges,
  GenerateButton,
  labels,
  type Run,
} from "./comfy-link";
import { RunError } from "./comfy-history";
import { CompareResults } from "./comfy-compare";

export function GenerationHistoryPage() {
  const app = useApp(),
    link = useLink();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [scope, setScope] = useState("all"),
    [newest, setNewest] = useState(true),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [compare, setCompare] = useState(false),
    [busy, setBusy] = useState(false);
  const [session, setSession] = useState("all");
  const [size, setSize] = useState(() => {
    const stored = Number(localStorage.getItem("comfy-history-image-size"));
    return stored >= 120 && stored <= 480 ? stored : 240;
  });
  const grid = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const projectKey = (run: Run) =>
    run.snapshot.project_id
      ? `id:${run.snapshot.project_id}`
      : run.project_path
        ? `path:${run.project_path.replaceAll("\\", "/").toLowerCase()}`
        : `unsaved:${run.session_id || "legacy"}`;
  const projects = latestOptions(link.status.runs, projectKey);
  const scopedRuns = link.status.runs.filter(
    (run) =>
      scope === "all" ||
      (scope === "project"
        ? belongsToProject(
            run,
            app.data.project,
            app.data.projectPath,
            link.status.session_id,
          )
        : projectKey(run) === scope),
  );
  const sessions = latestOptions(
    scopedRuns.filter((r) => r.session_id),
    (r) => r.session_id!,
  );
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      const top = el.getBoundingClientRect().top;
      const first = Array.from(
        el.querySelectorAll<HTMLElement>("[data-result-key]"),
      ).find((node) => node.getBoundingClientRect().bottom > top);
      if (first)
        anchor.current = {
          key: first.dataset.resultKey!,
          offset: first.getBoundingClientRect().top - top,
        };
      setSize((value) =>
        Math.max(120, Math.min(480, value + (event.deltaY < 0 ? 20 : -20))),
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useLayoutEffect(() => {
    localStorage.setItem("comfy-history-image-size", String(size));
    if (anchor.current && grid.current) {
      const el = grid.current;
      const node = Array.from(
        el.querySelectorAll<HTMLElement>("[data-result-key]"),
      ).find((n) => n.dataset.resultKey === anchor.current!.key);
      if (node)
        el.scrollTop +=
          node.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          anchor.current.offset;
      anchor.current = null;
    }
  }, [size]);
  const entries = useMemo(
    () =>
      link.status.runs
        .map((run, ordinal) => ({ run, ordinal: ordinal + 1 }))
        .filter(
          ({ run: r }) =>
            (filter === "all" || r.status === filter) &&
            (scope === "all" ||
              (scope === "project"
                ? belongsToProject(
                    r,
                    app.data.project,
                    app.data.projectPath,
                    link.status.session_id,
                  )
                : projectKey(r) === scope)) &&
            (session === "all" ||
              (session === "current"
                ? r.session_id === link.status.session_id
                : r.session_id === session)) &&
            (!query ||
              `${r.created} ${r.snapshot.generation.seed} ${r.state.Positive.Text} ${r.state.Negative.Text} ${r.project_path || ""} ${r.error || ""} ${JSON.stringify(r.snapshot.generation)}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase())),
        )
        .sort(
          (a, b) =>
            (newest ? -1 : 1) *
            (Date.parse(a.run.created) - Date.parse(b.run.created)),
        )
        .flatMap(({ run, ordinal }) =>
          run.outputs.length
            ? run.outputs.map((_, index) => ({
                run,
                ordinal,
                index,
                key: `${run.request_id}/${index}`,
              }))
            : [{ run, ordinal, index: 0, key: `${run.request_id}/0` }],
        ),
    [
      link.status.runs,
      query,
      filter,
      scope,
      session,
      newest,
      app.data.projectPath,
      app.data.project.Id,
      link.status.session_id,
    ],
  );
  const shown = entries.slice(page * 48, page * 48 + 48),
    chosen = entries.filter((e) => selected.includes(e.key)),
    focus = chosen.at(-1);
  const groups = shown.reduce<
    { key: string; title: string; items: typeof shown }[]
  >((out, e) => {
    const key = `${projectKey(e.run)}/${e.run.session_id || e.run.created.slice(0, 10)}`;
    let group = out.find((g) => g.key === key);
    if (!group) {
      const d = new Date(e.run.created),
        today = new Date();
      const name =
        e.run.project_path
          ?.split(/[\\/]/)
          .pop()
          ?.replace(/\.prompt-card\.png$/i, "") || "未命名会话";
      group = {
        key,
        title: `${d.toDateString() === today.toDateString() ? "今天" : d.toLocaleDateString()} · ${name}`,
        items: [],
      };
      out.push(group);
    }
    group.items.push(e);
    return out;
  }, []);
  const reset = () => {
    setPage(0);
    setSelected([]);
  };
  async function restore() {
    if (!focus || busy) return;
    setBusy(true);
    try {
      await link.restore(focus.run);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="generation-history">
      <header className="page-header">
        <h1>生成记录</h1>
        <span className="spacer" />
        <button
          className="history-sort"
          aria-label="生成记录排序"
          onClick={() => {
            setNewest((v) => !v);
            reset();
          }}
        >
          {newest ? "最新优先" : "最早优先"}
        </button>
        <IconButton
          icon={Funnel}
          label="筛选生成记录"
          onClick={() =>
            document
              .querySelector<HTMLSelectElement>(
                '.page-host:not([hidden]) [aria-label="筛选生成记录"]',
              )
              ?.focus()
          }
        />
        <IconButton
          icon={ArrowsLeftRight}
          label="对比所选两张结果"
          disabled={
            chosen.length !== 2 || chosen.some((x) => !x.run.outputs.length)
          }
          onClick={() => setCompare(true)}
        />
        <IconButton
          icon={FolderOpen}
          label="打开结果所在目录"
          disabled={!focus?.run.outputs.length}
          onClick={() => {
            if (focus)
              void link.imageActions(focus.run, focus.index)[2].action();
          }}
        />
        <IconButton
          icon={Flask}
          label="配置效果探针"
          onClick={() => app.open("probe")}
        />
        <GenerateButton />
      </header>
      <div className="history-body">
        <section className="history-list">
          <div className="history-toolbar">
            <MagnifyingGlass size={16} />
            <input
              aria-label="搜索生成记录"
              placeholder="搜索提示词、Seed 或工作流"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                reset();
              }}
            />
            <select
              aria-label="筛选生成记录"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                reset();
              }}
            >
              {[
                ["all", "全部结果"],
                ["completed", "已完成"],
                ["running", "生成中"],
                ["queued", "排队中"],
                ["failed", "失败"],
                ["cancelled", "已取消"],
                ["unknown", "受理待核对"],
              ].map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <SearchableSelect
              label="生成记录范围"
              value={scope}
              onChange={(value) => {
                setScope(value);
                setSession("all");
                reset();
              }}
              options={[
                { value: "all", label: "全部项目" },
                { value: "project", label: "当前项目" },
                ...projects.map(([key, run]) => ({
                  value: key,
                  label: `${run.project_path?.split(/[\\/]/).pop() || "未保存项目"} · ${(run.snapshot.project_id || run.session_id || "旧记录").slice(0, 8)}`,
                  search: `${run.project_path || ""} ${key}`,
                })),
              ]}
            />
            <SearchableSelect
              label="按会话筛选生成记录"
              value={session}
              onChange={(value) => {
                setSession(value);
                reset();
              }}
              options={[
                { value: "all", label: "全部会话" },
                { value: "current", label: "当前会话" },
                ...sessions.map(([key, run]) => ({
                  value: key,
                  label: `${new Date(run.created).toLocaleString()} · ${key.slice(0, 8)}`,
                  search: key,
                })),
              ]}
            />
            <span className="history-zoom" title="Ctrl + 滚轮调整图像大小">
              图像 {size} px
            </span>
          </div>
          <div
            className="history-grid"
            ref={grid}
            style={{ "--history-image-size": `${size}px` } as CSSProperties}
            title="Ctrl + 滚轮调整网格图像大小"
          >
            {groups.map((g) => (
              <section className="history-session" key={g.key}>
                <header>
                  <h3>{g.title}</h3>
                  <small>按会话分组 · 胶片条隐藏仍保留历史与原图</small>
                </header>
                <div className="history-session-grid">
                  {g.items.map((x) => (
                    <button
                      key={x.key}
                      data-result-key={x.key}
                      className={`history-result ${selected.includes(x.key) ? "selected" : ""}`}
                      aria-pressed={selected.includes(x.key)}
                      onClick={(e) =>
                        setSelected((v) =>
                          e.ctrlKey || e.metaKey
                            ? v.includes(x.key)
                              ? v.filter((k) => k !== x.key)
                              : [...v.slice(-1), x.key]
                            : [x.key],
                        )
                      }
                      onDoubleClick={() =>
                        link.inspect(x.run, x.index, entries)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (x.run.outputs.length)
                          link.imageMenu(x.run, x.index, e.clientX, e.clientY);
                      }}
                    >
                      <div className="history-thumbnail">
                        {x.run.outputs.length ? (
                          <ResultImage run={x.run} index={x.index} />
                        ) : (
                          <span className="result-placeholder">
                            {labels[x.run.status] || x.run.status}
                          </span>
                        )}
                      </div>
                      <span className="history-card-label">
                        #{x.ordinal} · Seed {x.run.snapshot.generation.seed}
                      </span>
                      <DiffBadges run={x.run} limit={3} />
                      <small className="history-state">
                        {labels[x.run.status]}
                        {x.run.film_hidden ? " · 已从胶片条隐藏" : ""}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {!entries.length && (
              <p className="history-empty">没有匹配的生成记录</p>
            )}
          </div>
          <div className="history-pagination" hidden={entries.length <= 48}>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(entries.length / 48))}
            </span>
            <button
              disabled={(page + 1) * 48 >= entries.length}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        </section>
        <aside className="history-detail">
          {focus ? (
            <>
              <header className="history-detail-heading">
                <h2>
                  #{focus.ordinal} ·{" "}
                  {focus.run.project_path
                    ?.split(/[\\/]/)
                    .pop()
                    ?.replace(/\.prompt-card\.png$/i, "") || "生成结果"}
                </h2>
                <div className="run-image-actions">
                  {link.imageActions(focus.run, focus.index).map((a) => (
                    <IconButton
                      key={a.label}
                      icon={a.icon}
                      label={a.label}
                      disabled={a.disabled || !focus.run.outputs.length}
                      onClick={() => void a.action()}
                    />
                  ))}
                </div>
              </header>
              <button
                className="history-large"
                aria-label="查看结果大图"
                disabled={!focus.run.outputs.length}
                onClick={() => link.inspect(focus.run, focus.index, entries)}
              >
                {focus.run.outputs.length ? (
                  <ResultImage run={focus.run} index={focus.index} />
                ) : (
                  <span className="result-placeholder">
                    {labels[focus.run.status]}
                  </span>
                )}
              </button>
              <p className="history-date">
                {new Date(focus.run.created).toLocaleString()}
              </p>
              <RunError run={focus.run} />
              <table className="history-parameters">
                <tbody>
                  <tr>
                    <th>Seed</th>
                    <td>{focus.run.snapshot.generation.seed}</td>
                  </tr>
                  <tr>
                    <th>尺寸 / 采样器</th>
                    <td>
                      {focus.run.snapshot.generation.width} ×{" "}
                      {focus.run.snapshot.generation.height} ·{" "}
                      {focus.run.snapshot.generation.sampler}
                    </td>
                  </tr>
                  <tr>
                    <th>步数 / CFG</th>
                    <td>
                      {focus.run.snapshot.generation.steps} /{" "}
                      {focus.run.snapshot.generation.cfg}
                    </td>
                  </tr>
                  <tr>
                    <th>LoRA</th>
                    <td>
                      {focus.run.snapshot.generation.model_controls?.lora.loras
                        .filter((l) => l.active)
                        .map((l) => `${l.name} · ${l.strength}`)
                        .join(", ") || "无"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <section className="history-differences">
                <h3>提示词与参数差异 · 此图 → 当前</h3>
                <DiffBadges run={focus.run} all />
                <p className="hint">
                  完整恢复包含积极 /
                  消极提示词、视觉组与成员、工作流分组、Seed、生成参数和模型设置。
                </p>
                <p className="hint" title={focus.run.request_id}>
                  记录 #{focus.ordinal} · 快照{" "}
                  {focus.run.snapshot.snapshot_id.slice(0, 8)} · 精确关联
                </p>
              </section>
              <div className="history-restore">
                <button
                  disabled={busy}
                  onClick={() => void link.pick(focus.run, focus.index)}
                >
                  选择差异…
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void restore()}
                >
                  <ArrowCounterClockwise size={16} />
                  回到此版本
                </button>
              </div>
            </>
          ) : (
            <p className="history-empty">选择结果查看参数、差异和操作</p>
          )}
        </aside>
      </div>
      {compare && chosen.length === 2 && (
        <CompareResults items={chosen} onClose={() => setCompare(false)} />
      )}
    </div>
  );
}
