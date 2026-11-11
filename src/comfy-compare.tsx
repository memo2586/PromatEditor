import { useEffect, useRef, useState } from "react";
import { ArrowsLeftRight, ArrowsOut, ArrowsIn, X } from "@phosphor-icons/react";
import { IconButton } from "./ui";
import { parameterChanges, mappingChanges } from "./parameter-diff";
import { ResultImage, changes, useLink, type Run } from "./comfy-link";
import { ResultViewport, ResultImagePlane } from "./result-viewport";

export function CompareResults({
  items,
  onClose,
}: {
  items: { run: Run; index: number }[];
  onClose: () => void;
}) {
  const link = useLink(),
    ref = useRef<HTMLElement>(null);
  const [swap, setSwap] = useState(false),
    [position, setPosition] = useState(50),
    [busy, setBusy] = useState(false),
    [full, setFull] = useState(false),
    [details, setDetails] = useState(false);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [a, b] = swap ? [...items].reverse() : items;
  const differences = changes(a.run.state, b.run.state);
  const parameters = [
    ...parameterChanges(a.run.snapshot.generation, b.run.snapshot.generation),
    ...mappingChanges(
      a.run.snapshot.comfy_group_targets,
      b.run.snapshot.comfy_group_targets,
    ),
  ];
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      origin.current?.focus();
    };
  }, []);
  async function adopt(run: Run) {
    setBusy(true);
    try {
      if (await link.restore(run)) onClose();
    } finally {
      setBusy(false);
    }
  }
  const number = (r: Run) =>
    link.status.runs.findIndex((item) => item.request_id === r.request_id) +
      1 || r.request_id.slice(0, 8);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className={`compare-page ${full ? "expanded" : ""}`}
      role="region"
      aria-label="A/B 对比"
    >
      <header className="page-header">
        <h1>A/B 对比</h1>
        <span className="spacer" />
        <button aria-expanded={details} onClick={() => setDetails((v) => !v)}>
          {details ? "收起差异" : "显示差异"}
        </button>
        <IconButton
          icon={ArrowsLeftRight}
          label="交换 A / B"
          onClick={() => setSwap((v) => !v)}
        />
        <IconButton
          icon={full ? ArrowsIn : ArrowsOut}
          label={full ? "退出全屏对比" : "全屏对比"}
          onClick={() => setFull((v) => !v)}
        />
        <button disabled={busy} onClick={() => void adopt(a.run)}>
          采用 A
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void adopt(b.run)}
        >
          采用 B
        </button>
        <IconButton icon={X} label="关闭 A/B 对比" onClick={onClose} />
      </header>
      <div className={`compare-content ${details ? "with-details" : ""}`}>
        <div className="compare-stage">
          <div className="compare-identity">
            <span>A · #{number(a.run)}</span>
            <small>
              Seed {a.run.snapshot.generation.seed} ·{" "}
              {a.run.snapshot.generation.width} ×{" "}
              {a.run.snapshot.generation.height}
            </small>
          </div>
          <div className="compare-identity right">
            <span>B · #{number(b.run)}</span>
            <small>
              Seed {b.run.snapshot.generation.seed} ·{" "}
              {b.run.snapshot.generation.width} ×{" "}
              {b.run.snapshot.generation.height}
            </small>
          </div>
          <ResultViewport
            key={items
              .map((item) => `${item.run.request_id}/${item.index}`)
              .join("|")}
            width={a.run.snapshot.generation.width}
            height={a.run.snapshot.generation.height}
            compare
            onScrub={(x, left, width) =>
              setPosition(
                Math.max(0, Math.min(100, ((x - left) / width) * 100)),
              )
            }
          >
            {(style) => (
              <>
                <div className="compare-layer">
                  <ResultImagePlane style={style}>
                    <ResultImage run={b.run} index={b.index} full />
                  </ResultImagePlane>
                </div>
                <div
                  className="compare-layer"
                  style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                >
                  <ResultImagePlane style={style}>
                    <ResultImage run={a.run} index={a.index} full />
                  </ResultImagePlane>
                </div>
                <div
                  className="compare-divider"
                  style={{ left: `${position}%` }}
                >
                  <button
                    role="slider"
                    aria-label="A/B 分界位置"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(position)}
                    onKeyDown={(e) => {
                      if (
                        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                          e.key,
                        )
                      ) {
                        e.preventDefault();
                        setPosition((v) =>
                          e.key === "Home"
                            ? 0
                            : e.key === "End"
                              ? 100
                              : Math.max(
                                  0,
                                  Math.min(
                                    100,
                                    v +
                                      (e.key === "ArrowLeft" ? -1 : 1) *
                                        (e.shiftKey ? 10 : 1),
                                  ),
                                ),
                        );
                      }
                    }}
                  >
                    <ArrowsLeftRight size={16} />
                  </button>
                </div>
              </>
            )}
          </ResultViewport>
        </div>
        <div className="compare-diffs" hidden={!details}>
          <section>
            <header>
              <h3>提示词差异 · A → B</h3>
              <small>{differences.length} 处</small>
            </header>
            {differences.map((s, i) => (
              <p
                className={`compare-diff ${s.startsWith("+") ? "added" : s.startsWith("−") ? "removed" : "changed"}`}
                key={i}
              >
                <span>
                  {s.startsWith("+")
                    ? "新增"
                    : s.startsWith("−")
                      ? "移除"
                      : "权重 / 结构"}
                </span>
                <strong>{s.replace(/^[+−]/, "")}</strong>
              </p>
            ))}
            {!differences.length && <p className="hint">提示词相同</p>}
            <p className="compare-adopt-hint">
              采用 A / B 将恢复对应图的完整参数，可 Ctrl+Z 撤销
            </p>
          </section>
          <section>
            <header>
              <h3>参数差异</h3>
            </header>
            <table>
              <tbody>
                {parameters.map((row, index) => (
                  <tr key={index}>
                    <th>{row.label}</th>
                    <td>
                      {row.from} → {row.to}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!parameters.length && (
              <p className="hint">相同 Seed、步数与采样器</p>
            )}
            <p className="hint">
              采用版本将恢复完整提示词、视觉组、生成参数和模型设置。
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
