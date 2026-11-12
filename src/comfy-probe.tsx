import { getLocale, tr } from "./i18n";
import {
  Images,
  Play,
  Lock,
  Plus,
  Minus,
  ArrowsLeftRight,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useApp } from "./context";
import { rpc } from "./api";
import { useLink, ResultImage, labels, type Run } from "./comfy-link";
import { RunError, CompareResults } from "./comfy-history";
import { IconButton, Segments } from "./ui";
export function openProbe(target: string, kind = "weight", negative = false) {
  window.dispatchEvent(
    new CustomEvent("prompt-editor.probe", {
      detail: { target, kind, negative },
    }),
  );
}
export function ProbePage() {
  const app = useApp(),
    link = useLink();
  const initial = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("probe-target") || "{}");
    } catch {
      return {};
    }
  })();
  const [kind, setKind] = useState(initial.kind || "weight"),
    [negative, setNegative] = useState(!!initial.negative),
    [target, setTarget] = useState(initial.target || ""),
    [values, setValues] = useState("0.6,0.8,1,1.2,1.4"),
    [probeId, setProbeId] = useState(
      localStorage.getItem("comfy-probe-id") || "",
    ),
    [busy, setBusy] = useState(false),
    [comparison, setComparison] = useState<Run[]>([]),
    [compare, setCompare] = useState(false);
  const [yEnabled, setYEnabled] = useState(false),
    [yKind, setYKind] = useState("weight"),
    [yTarget, setYTarget] = useState(""),
    [yNegative, setYNegative] = useState(false),
    [yValues, setYValues] = useState("0.8,1.2");
  const [seed, setSeed] = useState(String(app.data.generation.seed));
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const yTargets =
    yKind === "lora"
      ? app.data.generation.model_controls.lora.loras.map((l) => ({
          id: l.name,
          label: l.name,
        }))
      : (yNegative
          ? app.data.project.State.Negative
          : app.data.project.State.Positive
        ).Active.filter((t) => yKind === "presence" || t.Editable).map((t) => ({
          id: t.Id,
          label: t.Base,
        }));
  const valueLabel = (i: number) =>
    probe?.y_axis
      ? `X ${probe.values[i]} / Y ${probe.y_values[i]}`
      : String(probe?.values[i]);
  const probes = link.status.probes || [],
    probe = probes.find((p) => p.id === probeId);
  function clearProbe() {
    setProbeId("");
    localStorage.removeItem("comfy-probe-id");
    setSelectedIndex(null);
    setComparison([]);
  }
  useEffect(() => {
    if (!probe) return;
    setKind(probe.kind);
    setTarget(probe.target);
    setNegative(!!probe.negative);
    setSeed(String(probe.generation.seed));
    setValues([...new Set(probe.values)].join(","));
    setYEnabled(!!probe.y_axis);
    if (probe.y_axis) {
      setYKind(probe.y_axis.kind);
      setYTarget(probe.y_axis.target);
      setYNegative(!!probe.y_axis.negative);
      setYValues([...new Set(probe.y_values)].join(","));
    }
  }, [probe?.id]);
  const own = link.status.runs.filter((r) => r.probe?.id === probeId),
    latest = (i: number) =>
      own.filter((r) => (r.probe as any)?.index === i).at(-1);
  const workspace = negative
    ? app.data.project.State.Negative
    : app.data.project.State.Positive;
  const targets =
    kind === "lora"
      ? app.data.generation.model_controls.lora.loras.map((l) => ({
          id: l.name,
          label: l.name,
        }))
      : workspace.Active.filter((t) => kind === "presence" || t.Editable).map(
          (t) => ({ id: t.Id, label: t.Base }),
        );
  function currentValue(axis: {
    kind: string;
    target: string;
    negative?: boolean;
  }) {
    if (axis.kind === "lora") {
      const entry = app.data.generation.model_controls.lora.loras.find(
        (item) => item.name === axis.target,
      );
      return entry?.active && entry.strength === entry.clipStrength
        ? Number(entry.strength)
        : NaN;
    }
    const side = axis.negative
      ? app.data.project.State.Negative
      : app.data.project.State.Positive;
    const term = side.Active.find((item) => item.Id === axis.target);
    return axis.kind === "presence"
      ? term
        ? 1
        : 0
      : term
        ? Number(term.Weight)
        : NaN;
  }
  async function capture() {
    setBusy(true);
    try {
      if (!/^\d+$/.test(seed) || !Number.isSafeInteger(Number(seed)))
        throw Error(tr("请输入有效的固定 Seed"));
      await app.flush.current();
      for (const f of app.draftFlushers.current.values()) await f();
      const input =
        kind === "presence"
          ? [0, 1]
          : values
              .split(/[,，\s]+/)
              .filter(Boolean)
              .map(Number);
      if (
        !input.length ||
        input.length > 16 ||
        input.some((v) => !Number.isFinite(v))
      )
        throw Error(tr("请输入 1–16 个有效扫描值"));
      const p = await rpc<any>("runs.probe.prepare", {
        seed: Number(seed),
        client_id: link.client,
        kind,
        target,
        negative,
        values: input,
        ...(yEnabled
          ? {
              y_axis: {
                kind: yKind,
                target: yTarget,
                negative: yNegative,
                values:
                  yKind === "presence"
                    ? [0, 1]
                    : yValues
                        .split(/[,，\s]+/)
                        .filter(Boolean)
                        .map(Number),
              },
            }
          : {}),
      });
      setProbeId(p.id);
      localStorage.setItem("comfy-probe-id", p.id);
      await link.poll();
      app.notify(tr("已锁定探针基线与 Seed；后续编辑不影响变体"));
      return p;
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!probe) return;
    setBusy(true);
    try {
      const indices = probe.values
        .map((_: number, i: number) => i)
        .filter((i: number) => {
          const r = latest(i);
          return !r || ["failed", "cancelled", "rejected"].includes(r.status);
        });
      if (indices.length)
        await link.submit({ probe_id: probe.id, indices, lock_seed: true });
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    const queue = link.status.live.queue;
    const ids = own
      .filter((r) => r.prompt_id && queue?.pending.includes(r.prompt_id))
      .map((r) => r.prompt_id!);
    const current = own.find(
      (r) => r.prompt_id && queue?.running.includes(r.prompt_id),
    )?.prompt_id;
    if (!ids.length && !current) {
      app.notify(tr("没有已确认受理的探针任务；未知受理须先核对队列"));
      return;
    }
    const answer = await app.confirm({
      title: tr("取消此探针未完成任务？"),
      body: (
        <p>{tr("取消") + " "}{ids.length}{" " + tr("个等待任务")}{current ? tr("，并中断此探针当前任务") : ""}{tr("。保留所有已完成结果；其他任务继续保留。")}</p>
      ),
      confirm: tr("确认取消"),
      danger: true,
    });
    if (answer !== "confirm") return;
    setBusy(true);
    try {
      await rpc("runs.probe.cancel", {
        probe_id: probeId,
        ids,
        prompt_id: current || "",
        confirmed: true,
      });
      await link.poll();
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function applyVariant(run: Run, index: number) {
    if (busy) return;
    setBusy(true);
    try {
      await app.flush.current();
      for (const f of app.draftFlushers.current.values()) await f();
      const d = await rpc<{ revision: string }>("runs.diff", {
        request_id: run.request_id,
      });
      await app.act("runs.probe.apply", {
        probe_id: probeId,
        variant_index: index,
        revision: d.revision,
      });
      app.notify(tr("已应用探针值 · Ctrl+Z 可撤销"));
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const done = probe
    ? probe.values.filter(
        (_: number, i: number) => latest(i)?.status === "completed",
      ).length
    : 0;
  const pending = probe
    ? probe.values.filter((_: number, i: number) => {
        const r = latest(i);
        return !r || ["failed", "cancelled", "rejected"].includes(r.status);
      }).length
    : 0;
  const plannedCount =
    (kind === "presence"
      ? 2
      : values.split(/[,，\s]+/).filter(Boolean).length) *
    (yEnabled
      ? yKind === "presence"
        ? 2
        : yValues.split(/[,，\s]+/).filter(Boolean).length
      : 1);
  return (
    <div className="probe-page">
      <header className="page-header">
        <h1>{tr("词条效果探针")}</h1>
        <span className="spacer" />
        <button onClick={() => app.open("runs")}>{tr("关闭")}</button>
        <button
          className="primary"
          disabled={
            busy || link.busy || (!probe && !target) || (!!probe && !pending)
          }
          onClick={async () => {
            if (probe) await submit();
            else {
              const p = await capture();
              if (p)
                await link.submit({
                  probe_id: p.id,
                  indices: p.values.map((_: number, i: number) => i),
                  lock_seed: true,
                });
            }
          }}
        >
          <Play size={16} />
          {probe ? tr("生成未完成项 ({0})", pending) : tr("生成 {0} 张", plannedCount)}
        </button>
      </header>
      <div className="probe-body">
        <aside
          className="probe-config"
          onChangeCapture={(event) => {
            if (!(event.target as HTMLElement).closest(".probe-saved"))
              clearProbe();
          }}
        >
          <h2>{tr("试试效果")}</h2>
          <p className="hint">{tr("从词条菜单进入 ·")}{" "}
            {targets.find((t) => t.id === target)?.label || tr("选择扫描目标")}
          </p>
          <div className="probe-kind">
            <span>{tr("变量")}</span>
            <Segments
              label={tr("探针变量")}
              value={kind}
              onChange={(v) => {
                clearProbe();
                setKind(v);
                setTarget("");
              }}
              items={[
                { value: "weight", label: tr("权重") },
                { value: "presence", label: tr("有无") },
                { value: "lora", label: "LoRA" },
              ]}
            />
          </div>
          {kind !== "lora" && negative && (
            <label>{tr("工作区")}<select
                aria-label={tr("探针工作区")}
                value={String(negative)}
                onChange={(e) => {
                  setNegative(e.target.value === "true");
                  setTarget("");
                }}
              >
                <option value="false">{tr("积极提示词")}</option>
                <option value="true">{tr("消极提示词")}</option>
              </select>
            </label>
          )}
          <label>{tr("目标词条")}<select
              aria-label={tr("探针目标")}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">{tr("选择扫描目标")}</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {kind !== "presence" && (
            <label>{tr("X 轴 · {0}取值", tr(kind === "lora" ? "LoRA强度" : "权重"))}<input
                aria-label={tr("探针扫描值")}
                value={values}
                onChange={(e) => setValues(e.target.value)}
              />
            </label>
          )}
          <div className="probe-y-toggle">
            <span>{tr("Y 轴 ·") + " "}{yEnabled ? tr("已启用") : tr("无")}</span>
            <IconButton
              icon={yEnabled ? Minus : Plus}
              label={yEnabled ? tr("移除 Y 轴扫描变量") : tr("增加 Y 轴扫描变量")}
              onClick={() => {
                clearProbe();
                setYEnabled((v) => !v);
              }}
            />
          </div>
          {yEnabled && (
            <fieldset>
              <legend>{tr("Y 轴（组合最多16张）")}</legend>
              <label>{tr("变量")}<select
                  aria-label={tr("Y 轴变量")}
                  value={yKind}
                  onChange={(e) => {
                    setYKind(e.target.value);
                    setYTarget("");
                  }}
                >
                  <option value="weight">{tr("词条权重")}</option>
                  <option value="presence">{tr("词条有无")}</option>
                  <option value="lora">{tr("LoRA 强度")}</option>
                </select>
              </label>
              {yKind !== "lora" && (
                <label>{tr("工作区")}<select
                    aria-label={tr("Y 轴工作区")}
                    value={String(yNegative)}
                    onChange={(e) => {
                      setYNegative(e.target.value === "true");
                      setYTarget("");
                    }}
                  >
                    <option value="false">{tr("积极提示词")}</option>
                    <option value="true">{tr("消极提示词")}</option>
                  </select>
                </label>
              )}
              <label>{tr("目标")}<select
                  aria-label={tr("Y 轴目标")}
                  value={yTarget}
                  onChange={(e) => setYTarget(e.target.value)}
                >
                  <option value="">{tr("选择第二个目标")}</option>
                  {yTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {yKind !== "presence" && (
                <label>{tr("扫描值")}<input
                    aria-label={tr("Y 轴扫描值")}
                    value={yValues}
                    onChange={(e) => setYValues(e.target.value)}
                  />
                </label>
              )}
            </fieldset>
          )}
          <label className="probe-seed">
            <span>
              <Lock size={16} />{tr("固定 Seed")}</span>
            <input
              aria-label={tr("探针固定 Seed")}
              inputMode="numeric"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <p className="hint">{tr("其余参数来自锁定基线，重试仍保持")}</p>
          <p>
            {probe?.values.length || plannedCount}{" " + tr("个变体 · 进度来自真实执行")}</p>
          <p className="hint">{tr("单张") + " "}{probe?.generation.width || app.data.generation.width} ×{" "}
            {probe?.generation.height || app.data.generation.height} ·{" "}
            {probe?.generation.sampler || app.data.generation.sampler} ·{" "}
            {probe?.generation.steps || app.data.generation.steps}{" " + tr("步")}</p>
          <details className="probe-advanced">
            <summary>{tr("更多配置与已保存探针")}</summary>
            {kind !== "lora" && !negative && (
              <label>{tr("工作区")}<select
                  aria-label={tr("探针工作区")}
                  value={String(negative)}
                  onChange={(e) => {
                    setNegative(e.target.value === "true");
                    setTarget("");
                  }}
                >
                  <option value="false">{tr("积极提示词")}</option>
                  <option value="true">{tr("消极提示词")}</option>
                </select>
              </label>
            )}
            <button
              disabled={busy || !target || (yEnabled && !yTarget)}
              onClick={() => void capture()}
            >{tr("锁定新探针基线")}</button>
            <label className="probe-saved">{tr("已保存的探针")}<select
                aria-label={tr("已保存的探针")}
                value={probeId}
                onChange={(e) => {
                  setProbeId(e.target.value);
                  setSelectedIndex(null);
                  setComparison([]);
                  localStorage.setItem("comfy-probe-id", e.target.value);
                }}
              >
                <option value="">{tr("选择探针")}</option>
                {probes
                  .slice()
                  .reverse()
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {new Date(p.created).toLocaleString(getLocale())} ·{" "}
                      {p.target_label || p.kind}
                      {p.y_axis ? " · X/Y" : ""}
                    </option>
                  ))}
              </select>
            </label>
            {probe && (
              <>
                <p>{tr("已完成") + " "}{done}/{probe.values.length}{" " + tr("· 待生成/重试") + " "}{pending}
                </p>
                <progress
                  aria-label={tr("探针完成进度")}
                  value={done}
                  max={probe.values.length}
                />
                <button disabled={busy} onClick={() => void cancel()}>{tr("取消未完成任务")}</button>
              </>
            )}
          </details>
          <p className="hint">{tr("独立快照 · 取消保留已完成结果")}</p>
        </aside>
        <section className="probe-results">
          <header>
            <h2>
              {probe?.target_label ||
                targets.find((t) => t.id === target)?.label ||
                tr("选择目标")}{" "}
              ·{" "}
              {(probe?.kind || kind) === "presence"
                ? tr("有无对比")
                : (probe?.kind || kind) === "lora"
                  ? tr("LoRA 强度扫描")
                  : tr("权重扫描")}
            </h2>
            <small>
              {done} / {probe?.values.length || 0}{" " + tr("已完成")}</small>
          </header>
          <p className="hint">{tr("固定 Seed") + " "}{probe?.generation.seed ?? seed} ·{" "}
            {probe?.y_axis ? tr("X / Y 双轴变量") : tr("仅改变 X 轴变量")}
          </p>
          <div className="probe-grid">
            {probe ? (
              probe.values.map((value: number, i: number) => {
                const run = latest(i),
                  progress = link.status.live.runs?.find(
                    (r) => r.request_id === run?.request_id,
                  )?.progress;
                const isCurrent =
                  currentValue(probe) === value &&
                  (!probe.y_axis ||
                    currentValue(probe.y_axis) === probe.y_values[i]);
                return (
                  <section
                    className={`probe-cell ${selectedIndex === i || comparison.some((r) => r.request_id === run?.request_id) ? "selected" : ""}`}
                    key={i}
                    onPointerEnter={() => setSelectedIndex(i)}
                    onFocusCapture={() => setSelectedIndex(i)}
                  >
                    <h3>
                      {probe.y_axis
                        ? valueLabel(i)
                        : probe.kind === "presence"
                          ? value
                            ? tr("有")
                            : tr("无")
                          : value.toFixed(1)}
                    </h3>
                    {run?.outputs.length ? (
                      <button
                        className="probe-result"
                        aria-label={tr("查看探针结果大图 {0}", valueLabel(i))}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey || e.shiftKey)
                            setComparison((v) =>
                              v.some((r) => r.request_id === run.request_id)
                                ? v.filter(
                                    (r) => r.request_id !== run.request_id,
                                  )
                                : [...v.slice(-1), run],
                            );
                          else link.inspect(run, 0);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          link.imageMenu(run, 0, e.clientX, e.clientY);
                        }}
                      >
                        <ResultImage run={run} index={0} />
                      </button>
                    ) : (
                      <div className="probe-placeholder">
                        <span>{tr(labels[run?.status || ""] || "") || tr("未提交")}</span>
                        {progress?.max && (
                          <progress
                            aria-label={tr("变体 {0} 当前节点进度", value)}
                            value={progress.value || 0}
                            max={progress.max}
                          />
                        )}
                        <small>{progress?.node}</small>
                      </div>
                    )}
                    <p className="probe-caption">
                      {isCurrent
                        ? tr("当前值")
                        : `#P${String(i + 1).padStart(2, "0")}`}
                    </p>
                    {run?.outputs.length ? (
                      <div className="probe-apply-slot">
                        <span className="probe-apply-hint">{tr("悬停以应用")}</span>
                        <button
                          className="probe-apply primary"
                          disabled={busy}
                          onClick={() => void applyVariant(run, i)}
                        >{tr("应用") + " "}{valueLabel(i)}
                        </button>
                      </div>
                    ) : (
                      <span className="hint">
                        {run ? tr(labels[run.status] || "") : tr("等待生成")}
                      </span>
                    )}
                    {run?.error && <RunError run={run} />}
                  </section>
                );
              })
            ) : (
              <p className="hint">{tr("配置并锁定基线后生成独立变体；取消保留已完成图。")}</p>
            )}
          </div>
          <section className="probe-selection">
            <h3>
              {selectedIndex === null
                ? tr("选择结果查看应用值")
                : tr("选中 {0}", valueLabel(selectedIndex))}
            </h3>
            {selectedIndex !== null && probe && (
              <p className="changed">
                {probe.target_label}{" "}
                {probe.kind === "weight"
                  ? (workspace.Active.find((t) => t.Id === probe.target)
                      ?.Weight ?? tr("未知"))
                  : tr("当前值")}{" "}
                → {valueLabel(selectedIndex)}
                {probe.y_axis
                  ? ` · ${probe.y_axis.target_label} → ${probe.y_values[selectedIndex]}`
                  : ""}
              </p>
            )}
            <p className="hint">{tr("应用扫描值到当前目标词条，可 Ctrl+Z 撤销")}</p>
            <p className="hint">{tr("点击结果可放大；Ctrl / Shift 选两张进入 A/B 对比")}</p>
            <button
              disabled={comparison.length !== 2}
              onClick={() => setCompare(true)}
            >
              <ArrowsLeftRight size={16} />{tr("A/B 对比")}</button>
          </section>
        </section>
      </div>
      {compare && comparison.length === 2 && (
        <CompareResults
          items={comparison.map((run) => ({ run, index: 0 }))}
          onClose={() => setCompare(false)}
        />
      )}
    </div>
  );
}
