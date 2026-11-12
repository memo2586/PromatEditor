import { tr } from "./i18n";
import { useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { useApp } from "./context";
import { rpc } from "./api";
import { labels, useLink, type Run } from "./comfy-link";

export function RunError({ run }: { run: Run }) {
  const app = useApp(),
    link = useLink();
  const [busy, setBusy] = useState(false);
  const [locateError, setLocateError] = useState<{
    id: string;
    message: string;
  } | null>(null);
  if (!run.error && !run.execution_error) return null;
  const e = run.execution_error;
  const message = e?.exception_message || run.error || tr("未知执行错误");
  const title = e?.node_title || e?.node_type || tr("工作流节点");
  const summary = /out of memory|cuda.*memory|显存/i.test(message)
    ? tr("显存不足。降低尺寸或批量，空闲时可释放显存后重试。")
    : /lora|safetensors|not.*found|does not exist/i.test(message)
      ? tr("模型文件可能已移动、重命名或与工作流不匹配，请核对模型库。")
      : /shape|size.*match|dimension/i.test(message)
        ? tr("输入尺寸或模型结构不匹配，请检查该节点的输入与模型。")
        : /interrupt/i.test(message) || run.status === "cancelled"
          ? tr("此任务已中止，已完成的结果仍保留。")
          : tr("此节点未能完成执行，请查看原始信息并检查节点设置。");
  return (
    <section className="run-error" role="alert">
      <strong className="run-error-title">
        <WarningCircle size={16} />
        {title}
        {e?.node_id ? ` · #${e.node_id}` : ""}
      </strong>
      <p>{summary}</p>
      <p className="run-error-file">
        {message.match(/[\w.\\/-]+\.safetensors/i)?.[0] || message}
      </p>
      <small className="run-error-task">{tr("任务") + " "}{run.request_id.slice(0, 8)} · {tr(labels[run.status] || "") || run.status}
      </small>
      <div className="inline-actions">
        {/lora|safetensors|not.*found|does not exist/i.test(message) ? (
          <button onClick={() => app.open("lora")}>{tr("在 LoRA 库中替换")}</button>
        ) : (
          <button onClick={() => app.open("generation")}>{tr("调整生成参数")}</button>
        )}
        {/out of memory|cuda.*memory|显存/i.test(message) && (
          <button onClick={link.connect}>{tr("显存与连接")}</button>
        )}
        {e?.node_id && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setLocateError(null);
              try {
                await rpc("runs.locate", { request_id: run.request_id });
                app.notify(tr("浏览器已确认选中并居中目标节点"));
              } catch (e) {
                setLocateError({
                  id: run.request_id,
                  message: String(e).replace(/^Error:\s*/, ""),
                });
              } finally {
                setBusy(false);
              }
            }}
          >{tr("在 ComfyUI 中定位")}</button>
        )}
      </div>
      {locateError?.id === run.request_id && (
        <p role="alert">{locateError.message}</p>
      )}
      <details>
        <summary>{tr("原始执行信息")}</summary>
        <pre>{JSON.stringify(e || { error: run.error }, null, 2)}</pre>
      </details>
    </section>
  );
}
export { CompareResults } from "./comfy-compare";
export { GenerationHistoryPage } from "./comfy-history-page";
