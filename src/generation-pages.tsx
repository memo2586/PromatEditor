import { useListMotion } from "./motion";
import { useState, useEffect, useRef } from "react";
import {
  ArrowsClockwise,
  Info,
  DiceFive,
  ArrowsLeftRight,
  Plus,
  PencilSimple,
  ArrowUpRight,
  Stack,
  Copy,
  ArrowUp,
  ArrowDown,
  Trash,
  X,
  FloppyDisk,
} from "@phosphor-icons/react";
import { useApp } from "./context";
import {
  IconButton,
  Panel,
  PageHeading,
  Field,
  Switch,
  Notice,
  Modal,
  Empty,
} from "./ui";
import type { Generation, Loader } from "./types";
import { rpc } from "./api";
import { GenerateButton } from "./comfy-link";
import { ModelPicker } from "./model-picker";
const draftErrors = new Map<string, string>();
const numericKeys = [
  "seed",
  "steps",
  "cfg",
  "width",
  "height",
  "batch_size",
] as const;
const numericValues = (g: Generation) => ({
  seed: g.seed,
  steps: g.steps,
  cfg: g.cfg,
  width: g.width,
  height: g.height,
  batch_size: g.batch_size,
});
async function reportInvalid(key: string, error: string) {
  if (error) draftErrors.set(key, error);
  else draftErrors.delete(key);
  await rpc("generation.invalid", {
    error: [...draftErrors.values()].join("；") || null,
  });
}
function generationError(g: Generation) {
  if (!Number.isSafeInteger(g.seed) || g.seed < 0 || g.seed > 9007199254740991)
    return "Seed 须为 0–9007199254740991 之间的整数";
  if (!Number.isInteger(g.steps) || g.steps < 1 || g.steps > 10000)
    return "Steps 须为 1–10000 之间的整数";
  if (!Number.isFinite(g.cfg) || g.cfg < 0 || g.cfg > 100)
    return "CFG 须为 0–100";
  if (
    [g.width, g.height].some(
      (n) => !Number.isInteger(n) || n < 16 || n > 16384 || n % 8,
    )
  )
    return "宽高须为 16–16384 之间的 8 的倍数";
  if (
    !Number.isInteger(g.batch_size) ||
    g.batch_size < 1 ||
    g.batch_size > 4096
  )
    return "每批张数须为 1–4096 之间的整数";
  if (!g.sampler.trim()) return "请选择采样器";
  return "";
}
export function BridgeInfo({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [url, setUrl] = useState(app.data.bridge.comfyUrl);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="ComfyUI 连接详情"
      width={720}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>关闭</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await app.act("bridge.config", { url: url.trim() });
                app.notify("ComfyUI 连接已验证并保存");
                onClose();
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在测试连接…" : "测试并保存连接"}
          </button>
        </>
      }
    >
      <Notice error={!!app.data.bridge.error}>
        {app.data.bridge.error ||
          `编辑器接口已启动 · http://127.0.0.1:${app.data.bridge.port}`}
      </Notice>
      <dl className="details-list">
        <dt>已保存的 ComfyUI 地址</dt>
        <dd>{app.data.bridge.comfyUrl}</dd>
        <dt>ComfyUI 连接</dt>
        <dd>
          {app.data.bridge.comfyConnected
            ? "ComfyUI 已连接"
            : "ComfyUI 尚未连接"}
        </dd>
        <dt>工作流状态</dt>
        <dd>
          {app.data.bridge.workflowRead ? "工作流已读取" : "工作流尚未读取"}
        </dd>
        <dt>接口范围</dt>
        <dd>仅限本机</dd>
        <dt>最近实际读取</dt>
        <dd>{app.data.bridge.lastRead || "尚无读取记录"}</dd>
        <dt>基础参数</dt>
        <dd>{app.data.generationError || "当前参数有效"}</dd>
        <dt>Bridge 协议</dt>
        <dd>1 / 2 · 生成联动需 Bridge 1.4.0</dd>
      </dl>
      <Field label="本机 ComfyUI 地址">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:8188"
        />
      </Field>
      <p className="hint">
        ComfyUI
        与提示词编辑器应运行在同一台计算机。工作流浏览器提交前读取同一份提示词、参数和模型控制快照；成功入队后才更新种子。
        测试成功后才保存地址；测试失败时保留原连接配置。
      </p>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function PresetForm({
  width,
  height,
  onClose,
}: {
  width: number;
  height: number;
  onClose: () => void;
}) {
  const app = useApp();
  const [name, setName] = useState("");
  const [w, setW] = useState(String(width));
  const [h, setH] = useState(String(height));
  const [error, setError] = useState("");
  return (
    <Modal
      title="添加尺寸预设"
      width={520}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                if (!w.trim() || !h.trim()) throw Error("宽高不能为空");
                await app.act("presets.add", {
                  Name: name,
                  Width: Number(w),
                  Height: Number(h),
                });
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            保存并应用
          </button>
        </>
      }
    >
      <Field label="预设名称（可选）">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="form-columns">
        <Field label="宽度">
          <input
            type="number"
            value={w}
            onChange={(e) => setW(e.target.value)}
          />
        </Field>
        <Field label="高度">
          <input
            type="number"
            value={h}
            onChange={(e) => setH(e.target.value)}
          />
        </Field>
      </div>
      <p className="hint">宽高须为 8 的倍数。相同尺寸不会重复添加。</p>
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
function WorkflowForm({
  addOnly = false,
  onClose,
}: {
  addOnly?: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const [groups, setGroups] = useState(
    structuredClone(app.data.generation.groups),
  );
  const [name, setName] = useState("");
  const [bypasser, setBypasser] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    if (!name.trim()) {
      setError("分组名称不能为空");
      return;
    }
    if (
      groups.some(
        (g) => g.name === name.trim() && g.bypasser_id === bypasser.trim(),
      )
    ) {
      setError("同一控制器中不能有重名分组");
      return;
    }
    setGroups([
      ...groups,
      { name: name.trim(), bypasser_id: bypasser.trim(), enabled: true },
    ]);
    setName("");
    setError("");
  };
  return (
    <Modal
      title={addOnly ? "添加工作流分组" : "管理工作流分组"}
      width={760}
      onClose={onClose}
      footer={
        <>
          <span className="hint">名称与控制器 ID 共同标识分组</span>
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                let next = groups;
                if (addOnly && name.trim())
                  next = [
                    ...groups,
                    {
                      name: name.trim(),
                      bypasser_id: bypasser.trim(),
                      enabled: true,
                    },
                  ];
                await app.act("generation.set", {
                  value: { ...app.data.generation, groups: next },
                });
                onClose();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            保存分组
          </button>
        </>
      }
    >
      <div className="form-columns">
        <Field label="分组名称">
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="控制器 ID（可选）">
          <input
            value={bypasser}
            onChange={(e) => setBypasser(e.target.value)}
          />
        </Field>
        <IconButton icon={Plus} label="加入分组列表" onClick={add} />
      </div>
      {!addOnly && (
        <div className="workflow-manage">
          {groups.map((g, i) => (
            <div key={i} className="workflow-manage-row">
              <input
                aria-label={`分组 ${i + 1} 名称`}
                value={g.name}
                onChange={(e) =>
                  setGroups(
                    groups.map((g, j) =>
                      i === j ? { ...g, name: e.target.value } : g,
                    ),
                  )
                }
              />
              <input
                aria-label={`分组 ${i + 1} 控制器 ID`}
                value={g.bypasser_id}
                onChange={(e) =>
                  setGroups(
                    groups.map((g, j) =>
                      i === j ? { ...g, bypasser_id: e.target.value } : g,
                    ),
                  )
                }
              />
              <Switch
                checked={g.enabled}
                label={`启用分组 ${g.name}`}
                onChange={(v) =>
                  setGroups(
                    groups.map((g, j) => (i === j ? { ...g, enabled: v } : g)),
                  )
                }
              />
              <IconButton
                icon={Trash}
                label={`删除分组 ${g.name}`}
                onClick={() => setGroups(groups.filter((_, j) => j !== i))}
              />
            </div>
          ))}
        </div>
      )}
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
export function GenerationPage() {
  const app = useApp();
  const g = app.data.generation;
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ["seed", "steps", "cfg", "width", "height", "batch_size"].map((k) => [
        k,
        String(g[k as keyof Generation]),
      ]),
    ),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [samplers, setSamplers] = useState<string[]>([
    "euler",
    "euler_ancestral",
    "heun",
    "dpm_2",
    "dpm_2_ancestral",
    "lms",
    "dpm_fast",
    "dpm_adaptive",
    "dpmpp_2s_ancestral",
    "dpmpp_sde",
    "dpmpp_2m",
    "dpmpp_2m_sde",
    "ddim",
    "uni_pc",
  ]);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draft = useRef(g);
  useEffect(() => {
    if (!draftErrors.has("base") && !commitTimer.current) {
      draft.current = g;
      setFields(
        Object.fromEntries(
          ["seed", "steps", "cfg", "width", "height", "batch_size"].map((k) => [
            k,
            String(g[k as keyof Generation]),
          ]),
        ),
      );
    }
  }, [g]);
  const update = async (patch: Partial<Generation>) => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    try {
      const numericPatch = Object.fromEntries(
        numericKeys.filter((k) => k in patch).map((k) => [k, patch[k]]),
      );
      const hasNumeric = Object.keys(numericPatch).length > 0;
      if (hasNumeric) {
        draft.current = { ...draft.current, ...numericPatch };
        setFields(
          Object.fromEntries(
            numericKeys.map((k) => [k, String(draft.current[k])]),
          ),
        );
      }
      const invalid = generationError(draft.current);
      setError(invalid);
      if (invalid && hasNumeric) {
        await reportInvalid("base", invalid);
        return;
      }
      const next = {
        ...app.data.generation,
        ...(!invalid ? numericValues(draft.current) : {}),
        ...patch,
      };
      await app.act("generation.set", { value: next });
      const latestError = generationError(draft.current);
      setError(latestError);
      await reportInvalid("base", latestError);
    } catch (e) {
      setError(String(e));
      await reportInvalid("base", String(e));
    }
  };
  const field = (key: string, value: string) => {
    const nextFields = { ...fields, [key]: value };
    setFields(nextFields);
    const next = {
      ...app.data.generation,
      ...Object.fromEntries(
        Object.entries(nextFields).map(([k, v]) => [
          k,
          v.trim() === "" ? NaN : Number(v),
        ]),
      ),
    };
    draft.current = next;
    const invalid = generationError(next);
    setError(invalid);
    void reportInvalid("base", invalid);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    if (!invalid)
      commitTimer.current = setTimeout(
        () => void update(numericValues(next)),
        200,
      );
  };
  useEffect(() => {
    app.draftGuards.current.set("generation", async () => {
      if (!error) return true;
      app.open("generation");
      app.notify("请先修正生成参数草稿，再关闭或切换项目");
      return false;
    });
    return () => {
      app.draftGuards.current.delete("generation");
    };
  }, [error]);
  useEffect(() => {
    app.draftFlushers.current.set("generation", async () => {
      if (commitTimer.current) await update(numericValues(draft.current));
      const invalid = generationError(draft.current);
      if (invalid) await reportInvalid("base", invalid);
    });
    return () => {
      app.draftFlushers.current.delete("generation");
    };
  });
  useEffect(() => {
    app.draftRepairs.current.set("generation.size", async () => {
      const round = (value: number, fallback: number) => Math.max(16, Math.min(16384, Math.round((Number.isFinite(value) ? value : fallback) / 8) * 8));
      await update({ width: round(draft.current.width, g.width), height: round(draft.current.height, g.height) });
    });
    return () => { app.draftRepairs.current.delete("generation.size"); };
  });
  const numeric = (
    key: string,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) => (
    <Field label={label}>
      <input
        className="mono"
        type="number"
        min={min}
        max={max}
        step={step}
        value={fields[key]}
        aria-invalid={!!error}
        onChange={(e) => field(key, e.target.value)}
        onBlur={() => {
          if (!error) void update(numericValues(draft.current));
        }}
      />
    </Field>
  );
  const read = async (kind: "samplers" | "groups") => {
    setBusy(kind);
    try {
      const catalog = await app.act<any>("bridge.catalog");
      if (catalog.samplers?.length) setSamplers(catalog.samplers);
      if (kind === "groups") {
        const next = catalog.groups;
        if (!Array.isArray(next) || !next.length) {
          app.notify("没有读取到工作流分组，当前列表已保留");
          return;
        }
        const answer = await app.confirm({
          title: "替换工作流分组？",
          body: (
            <p>
              将用读取到的 {next.length} 个分组替换当前 {g.groups.length}{" "}
              个分组。原开关状态会按名称和控制器 ID 尽量保留。
            </p>
          ),
          confirm: "替换分组",
        });
        if (answer === "confirm") {
          const groups = next.map((x: any) => ({
            ...x,
            enabled:
              g.groups.find(
                (v) =>
                  v.name === x.name && v.bypasser_id === (x.bypasser_id || ""),
              )?.enabled ??
              x.enabled ??
              false,
          }));
          await update({ groups });
        }
      }
    } catch (e) {
      app.reportError(`${e}；当前设置已保留`);
    } finally {
      setBusy("");
    }
  };
  const bridge = () =>
    app.modal(<BridgeInfo onClose={() => app.modal(null)} />);
  const enabled = g.groups.filter((g) => g.enabled).length;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return (
    <div className="standard-page">
      <PageHeading
        title="生成参数"
        description="参数独立保存，ComfyUI 提交任务时读取当前有效值。"
        status={error ? "草稿无效 · 暂停同步" : "参数已自动保存"}
        actions={
          <>
            <IconButton
              icon={ArrowsClockwise}
              label="刷新采样器"
              disabled={!!busy}
              onClick={() => void read("samplers")}
            />
            <IconButton icon={Info} label="ComfyUI 连接详情" onClick={bridge} />
            <GenerateButton />
          </>
        }
      />
      <div className="generation-layout">
        <div className="generation-left">
          <Panel
            title="基础参数"
            className="parameters-panel"
            actions={
              <>
                <span className="hint">提交时同步给种子</span>
                <Switch
                  checked={g.enabled}
                  label="提交时同步基础参数"
                  onChange={(v) => void update({ enabled: v })}
                />
              </>
            }
          >
            <div className="parameter-section seed-section">
              <div className="seed-input">
                <Field label="当前种子 · Seed">
                  <div className="input-action">
                    <input
                      className="mono"
                      type="number"
                      min="0"
                      max="9007199254740991"
                      value={fields.seed}
                      onChange={(e) => field("seed", e.target.value)}
                    />
                    <IconButton
                      icon={DiceFive}
                      label="立即随机种子"
                      disabled={!!error}
                      onClick={() =>
                        void app
                          .act("generation.random")
                          .catch((e) => app.reportError(String(e)))
                      }
                    />
                  </div>
                </Field>
              </div>
              <Field label="生成后控制">
                <select
                  value={g.seed_control}
                  onChange={(e) =>
                    void update({ seed_control: e.target.value })
                  }
                >
                  <option value="fixed">固定</option>
                  <option value="increment">递增</option>
                  <option value="decrement">递减</option>
                  <option value="randomize">每次随机</option>
                </select>
              </Field>
            </div>
            <div className="parameter-section sampling-section">
              <Field label="采样器 · Sampler">
                <div className="input-action">
                  <select
                    value={g.sampler}
                    onChange={(e) => void update({ sampler: e.target.value })}
                  >
                    {[...new Set([g.sampler, ...samplers])].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <IconButton
                    icon={ArrowsClockwise}
                    label="刷新采样器列表"
                    disabled={!!busy}
                    onClick={() => void read("samplers")}
                  />
                </div>
              </Field>
              {numeric("steps", "步数 · Steps", 1, 10000)}
              {numeric("cfg", "提示词引导 · CFG", 0, 100, 0.1)}
            </div>
            <div className="parameter-section size-section">
              <Field label="尺寸预设">
                <div className="input-action">
                  <select
                    value={`${g.width}x${g.height}`}
                    onChange={(e) => {
                      const [w, h] = e.target.value.split("x").map(Number);
                      void update({ width: w, height: h });
                    }}
                  >
                    {!app.data.presets.some(
                      (p) => p.Width === g.width && p.Height === g.height,
                    ) && (
                      <option value={`${g.width}x${g.height}`}>
                        自定义 · {g.width} × {g.height}
                      </option>
                    )}
                    {app.data.presets.map((p) => (
                      <option
                        key={`${p.Width}x${p.Height}`}
                        value={`${p.Width}x${p.Height}`}
                      >
                        {p.Name ? `${p.Name} · ` : ""}
                        {p.Width} × {p.Height} ·{" "}
                        {p.Width / gcd(p.Width, p.Height)}:
                        {p.Height / gcd(p.Width, p.Height)}
                      </option>
                    ))}
                  </select>
                  <IconButton
                    icon={Plus}
                    label="添加当前尺寸为自定义预设"
                    onClick={() =>
                      app.modal(
                        <PresetForm
                          width={g.width}
                          height={g.height}
                          onClose={() => app.modal(null)}
                        />,
                      )
                    }
                  />
                </div>
              </Field>
              <div className="dimensions-row">
                {numeric("width", "宽度 · Width", 16, 16384, 8)}
                <IconButton
                  icon={ArrowsLeftRight}
                  label="交换宽高"
                  onClick={() =>
                    void update({ width: g.height, height: g.width })
                  }
                />
                {numeric("height", "高度 · Height", 16, 16384, 8)}
                {numeric("batch_size", "每批张数", 1, 4096)}
              </div>
              {error && (
                <>
                  <Notice error>{error}</Notice>
                  {/宽高/.test(error) && (
                    <button
                      onClick={() => {
                        const width = Math.max(
                          16,
                          Math.min(
                            16384,
                            Math.round(Number(fields.width) / 8) * 8,
                          ),
                        );
                        const height = Math.max(
                          16,
                          Math.min(
                            16384,
                            Math.round(Number(fields.height) / 8) * 8,
                          ),
                        );
                        setError("");
                        setFields({
                          ...fields,
                          width: String(width),
                          height: String(height),
                        });
                        void reportInvalid("base", "");
                        void update({ width, height });
                      }}
                    >
                      将宽高修正为最接近的 8 的倍数
                    </button>
                  )}
                </>
              )}
            </div>
          </Panel>
          <Panel
            title="连接与读取"
            className="connection-panel"
            actions={
              <IconButton
                icon={ArrowUpRight}
                label="打开连接详情"
                onClick={bridge}
              />
            }
          >
            <div className="connection-body">
              <p>
                <i
                  className={
                    app.data.bridge.error ? "status-dot failed" : "status-dot"
                  }
                />
                {app.data.bridge.error ||
                  `编辑器接口已启动 · 127.0.0.1:${app.data.bridge.port}`}
              </p>
              <p className="hint">
                {app.data.bridge.comfyUrl} ·{" "}
                {app.data.bridge.comfyConnected
                  ? "ComfyUI 已连接"
                  : "ComfyUI 尚未连接"}{" "}
                ·{" "}
                {app.data.bridge.workflowRead
                  ? "工作流已读取"
                  : "工作流尚未读取"}
              </p>
              <p className="hint">
                最近读取 {app.data.bridge.lastRead || "尚无记录"} ·{" "}
                {app.data.generationError || "生成参数有效"}
              </p>
              <p className="hint">
                入队成功后更新下一个种子；当前读取使用提交时的同一份快照。
              </p>
            </div>
          </Panel>
        </div>
        <Panel
          title="工作流分组"
          className="workflow-panel"
          actions={
            <>
              <IconButton
                icon={ArrowsClockwise}
                label="读取工作流分组"
                disabled={!!busy}
                onClick={() => void read("groups")}
              />
              <IconButton
                icon={Plus}
                label="手动添加工作流分组"
                onClick={() =>
                  app.modal(
                    <WorkflowForm addOnly onClose={() => app.modal(null)} />,
                  )
                }
              />
              <IconButton
                icon={PencilSimple}
                label="管理工作流分组"
                onClick={() =>
                  app.modal(<WorkflowForm onClose={() => app.modal(null)} />)
                }
              />
            </>
          }
        >
          <p className="workflow-summary">
            {busy === "groups"
              ? "正在读取工作流分组…"
              : `${enabled} 启用 · ${g.groups.length - enabled} 旁路`}
          </p>
          <div className="workflow-list">
            {g.groups.map((group, i) => (
              <div
                className="workflow-row"
                key={`${group.bypasser_id}-${group.name}`}
              >
                <Stack size={16} />
                <span
                  title={`${group.name}${group.bypasser_id ? " · #" + group.bypasser_id : ""}`}
                >
                  {group.name}
                </span>
                <small>{group.enabled ? "启用" : "旁路"}</small>
                <Switch
                  checked={group.enabled}
                  label={`工作流分组 ${group.name}`}
                  onChange={(v) =>
                    void update({
                      groups: g.groups.map((x, j) =>
                        j === i ? { ...x, enabled: v } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
            {!g.groups.length && (
              <Empty
                title="暂无工作流分组"
                description="从 ComfyUI 读取，或手动添加分组。"
              />
            )}
          </div>
          <footer className="panel-footer hint">仅影响匹配的工作流分组</footer>
        </Panel>
      </div>
    </div>
  );
}
type Catalog = {
  nodes: { node_id: string; node_type: string; title?: string }[];
  loras: string[];
  unets: string[];
  lm_unets: string[];
  vaes: string[];
  updated_at: number | null;
};
type ModelControls = Generation["model_controls"];
type LoraRow = Loader["loras"][number] & { draftId: string };
type ModelDraft = Omit<ModelControls, "lora"> & {
  lora: Omit<Loader, "loras"> & { loras: LoraRow[] };
};
function modelDraft(value: ModelControls, previous?: ModelDraft): ModelDraft {
  const available = [...(previous?.lora.loras || [])];
  return {
    ...value,
    lora: {
      ...value.lora,
      loras: value.lora.loras.map((row) => {
        const index = available.findIndex((other) => other.name === row.name);
        const previousRow =
          index >= 0 ? available.splice(index, 1)[0] : undefined;
        return {
          ...row,
          draftId:
            (row as Partial<LoraRow>).draftId ||
            previousRow?.draftId ||
            crypto.randomUUID(),
        };
      }),
    },
  };
}
export function ModelsPage() {
  const app = useApp();
  const [models, setModels] = useState(() =>
    modelDraft(app.data.generation.model_controls),
  );
  const modelsRef = useRef(models);
  const savedModels = useRef(app.data.generation.model_controls);
  const editRevision = useRef(0);
  const pendingWrites = useRef(new Set<Promise<unknown>>());
  const strengthErrors = useRef(new Map<string, string>());
  useEffect(() => {
    savedModels.current = app.data.generation.model_controls;
    if (!draftErrors.has("models") && !pendingWrites.current.size) {
      const next = modelDraft(savedModels.current, modelsRef.current);
      modelsRef.current = next;
      setModels(next);
      setStrengthDraft({});
      strengthErrors.current.clear();
    }
  }, [app.data.generation.model_controls]);
  const [catalog, setCatalog] = useState<Catalog>({
    nodes: [],
    loras: [],
    unets: [],
    lm_unets: [],
    vaes: [],
    updated_at: null,
  });
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const listMotionRef = useRef<HTMLDivElement>(null);
  useListMotion(listMotionRef, ".controller-row:not([data-motion-exit])", models.lora.loras.map((l) => l.draftId).join("|"), query);
  const [picker, setPicker] = useState("");
  const [error, setError] = useState("");
  const [strengthDraft, setStrengthDraft] = useState<Record<string, string>>(
    {},
  );
  const discard = async () => {
    editRevision.current++;
    await Promise.allSettled([...pendingWrites.current]);
    const next = modelDraft(savedModels.current, modelsRef.current);
    modelsRef.current = next;
    setModels(next);
    setStrengthDraft({});
    strengthErrors.current.clear();
    setError("");
    await reportInvalid("models", "");
  };
  useEffect(() => {
    app.draftGuards.current.set("models", async () => {
      await Promise.allSettled([...pendingWrites.current]);
      if (!draftErrors.has("models")) return true;
      const answer = await app.confirm({
        title: "模型控制草稿无效",
        body: <p>请返回编辑修正字段，或放弃尚未自动保存的模型控制修改。</p>,
        confirm: "返回编辑",
        cancel: "取消",
        third: "放弃未保存的修改",
      });
      if (answer === "third") {
        await discard();
        return true;
      }
      app.open("models");
      return false;
    });
    return () => {
      app.draftGuards.current.delete("models");
    };
  }, [error]);
  useEffect(() => {
    app.draftFlushers.current.set("models", async () => {
      await Promise.allSettled([...pendingWrites.current]);
      const invalid = draftErrors.get("models");
      if (invalid) await reportInvalid("models", invalid);
    });
    return () => {
      app.draftFlushers.current.delete("models");
    };
  }, []);
  const save = async (value: ModelControls) => {
    const revision = ++editRevision.current;
    const next = modelDraft(value, modelsRef.current);
    const rowIds = new Set(next.lora.loras.map((row) => row.draftId));
    for (const key of strengthErrors.current.keys()) {
      if (!rowIds.has(key.slice(0, key.lastIndexOf(":"))))
        strengthErrors.current.delete(key);
    }
    setStrengthDraft((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) =>
          rowIds.has(key.slice(0, key.lastIndexOf(":"))),
        ),
      ),
    );
    modelsRef.current = next;
    setModels(next);
    let invalid = [...strengthErrors.current.values()].join("；");
    for (const kind of ["lora", "unet", "vae"] as const) {
      const c = next[kind];
      if (
        c.enabled &&
        (!c.node_id || !c.node_type || (kind !== "lora" && !c.model))
      )
        invalid ||= `请选择 ${kind.toUpperCase()} 的有效目标节点及模型`;
    }
    if (invalid) {
      setError(invalid);
      await reportInvalid("models", invalid);
      return;
    }
    const request = app.act("generation.set", {
      value: {
        ...app.data.generation,
        model_controls: {
          ...next,
          lora: {
            ...next.lora,
            loras: next.lora.loras.map(({ draftId: _draftId, ...row }) => row),
          },
        },
      },
    });
    pendingWrites.current.add(request);
    try {
      const saved = await request;
      savedModels.current = saved.generation.model_controls;
      if (editRevision.current === revision) {
        setError("");
        await reportInvalid("models", "");
      } else {
        // Keep the combined draft report current when an older write finishes.
        await reportInvalid("models", draftErrors.get("models") || "");
      }
    } catch (e) {
      if (editRevision.current === revision) {
        setError(String(e));
        await reportInvalid("models", String(e));
      }
    } finally {
      pendingWrites.current.delete(request);
    }
  };
  const update = (kind: "lora" | "unet" | "vae", patch: Partial<Loader>) =>
    save({
      ...modelsRef.current,
      [kind]: { ...modelsRef.current[kind], ...patch },
    });
  const read = async () => {
    setBusy(true);
    try {
      const value = await app.act<Catalog>("bridge.models");
      setCatalog(value);
      if (!value.nodes.length)
        app.notify("没有读取到工作流目标节点；当前模型控制已保留");
    } catch (e) {
      app.reportError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const target = (kind: "lora" | "unet" | "vae") => {
    const c = models[kind];
    const types =
      kind === "lora"
        ? ["Lora Loader (LoraManager)"]
        : kind === "unet"
          ? ["UNETLoader", "Unet Loader (LoraManager)"]
          : ["VAELoader"];
    const nodes = catalog.nodes.filter((n) => types.includes(n.node_type));
    return (
      <Field label="目标节点">
        <select
          value={c.node_id}
          onChange={(e) => {
            const n = nodes.find((n) => n.node_id === e.target.value);
            void update(kind, {
              node_id: e.target.value,
              node_type: n?.node_type || "",
            });
          }}
        >
          <option value="">请选择目标节点</option>
          {c.node_id && !nodes.some((n) => n.node_id === c.node_id) && (
            <option value={c.node_id}>
              #{c.node_id} · {c.node_type}（尚未读取）
            </option>
          )}
          {nodes.map((n) => (
            <option key={n.node_id} value={n.node_id}>
              #{n.node_id} · {n.title || n.node_type}
            </option>
          ))}
        </select>
      </Field>
    );
  };
  const nameCopy = (name: string) => {
    let n = app.data.settings.LoraCopyIncludeDirectory
      ? name
      : name.split(/[\\/]/).at(-1) || name;
    if (!app.data.settings.LoraCopyIncludeExtension)
      n = n.replace(/\.[^.]+$/, "");
    void navigator.clipboard
      .writeText(n)
      .then(() => app.notify("模型名称已复制"));
  };
  const reorder = (i: number, j: number) => {
    const loras = [...modelsRef.current.lora.loras];
    [loras[i], loras[j]] = [loras[j], loras[i]];
    void update("lora", { loras });
  };
  const loader = (kind: "unet" | "vae") => {
    const c = models[kind];
    const choices =
      kind === "unet"
        ? c.node_type === "Unet Loader (LoraManager)"
          ? catalog.lm_unets
          : catalog.unets
        : catalog.vaes;
    return (
      <Panel
        title={kind === "unet" ? "UNet 加载器" : "VAE 加载器"}
        className={`${kind}-panel`}
        actions={
          <>
            <span className="hint">控制此节点</span>
            <Switch
              checked={c.enabled}
              label={`控制 ${kind.toUpperCase()} 节点`}
              onChange={(v) => void update(kind, { enabled: v })}
            />
          </>
        }
      >
        <div className="loader-body">
          {target(kind)}
          <Field label={kind === "unet" ? "模型 · UNet" : "模型 · VAE"}>
            <ModelPicker label={`搜索或选择 ${kind === "unet" ? "UNet" : "VAE"}`} listLabel={`可选 ${kind === "unet" ? "UNet" : "VAE"}`} modelType={kind === "unet" ? "UNet" : "VAE"}
              options={choices} value={c.model} onChange={(model) => void update(kind, { model })} />
          </Field>
          {kind === "unet" && (
            <Field label="权重精度 · Weight dtype">
              <select
                value={c.weight_dtype}
                onChange={(e) =>
                  void update(kind, { weight_dtype: e.target.value })
                }
              >
                {["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </Field>
          )}
        </div>
      </Panel>
    );
  };
  return (
    <div className="standard-page">
      <PageHeading
        title="模型控制"
        description="三个控制器独立开关；关闭时保留草稿并沿用工作流原设置。"
        status={
          busy
            ? "正在读取节点与模型…"
            : error
              ? "模型控制草稿无效"
              : "模型控制已自动保存"
        }
        actions={
          <>
            <IconButton
              icon={ArrowsClockwise}
              label="读取节点与模型"
              disabled={busy}
              onClick={read}
            />
            <IconButton
              icon={Info}
              label="ComfyUI 连接详情"
              onClick={() =>
                app.modal(<BridgeInfo onClose={() => app.modal(null)} />)
              }
            />
            <GenerateButton />
          </>
        }
      />
      <div className="models-layout">
        <Panel
          title="LoRA Manager"
          className="lora-controller"
          actions={
            <>
              <span className="hint">控制此节点</span>
              <Switch
                checked={models.lora.enabled}
                label="控制 LoRA Manager 节点"
                onChange={(v) => void update("lora", { enabled: v })}
              />
            </>
          }
        >
          <div className="lora-target-row">
            {target("lora")}
            <IconButton
              icon={Stack}
              label="浏览 LoRA 模型库"
              onClick={() => app.open("lora")}
            />
          </div>
          <div className="controller-toolbar">
            <span className="hint">
              提交时替换此节点的 LoRA 列表，关闭的条目仍保留。
            </span>
            <input
              aria-label="搜索已添加 LoRA"
              placeholder="搜索已添加 LoRA…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="controller-columns">
            <span>LoRA 模型</span>
            <span>Model</span>
            <span>CLIP</span>
            <span>启用</span>
            <span />
          </div>
          <div ref={listMotionRef} className="controller-list">
            {models.lora.loras.map(
              (l, i) =>
                l.name.toLowerCase().includes(query.toLowerCase()) && (
                  <div className="controller-row" data-motion-id={l.draftId} key={l.draftId}>
                    <div className="controller-name">
                      <span className="mono" title={l.name}>
                        {l.name}
                      </span>
                      <IconButton
                        icon={Copy}
                        label={`复制模型名称 ${l.name}`}
                        onClick={() => nameCopy(l.name)}
                      />
                    </div>
                    {(["strength", "clipStrength"] as const).map((k) => (
                      <input
                        aria-label={`${l.name} ${k === "strength" ? "Model" : "CLIP"} 强度`}
                        className="mono"
                        key={k}
                        type="number"
                        min="-20"
                        max="20"
                        step="0.1"
                        value={strengthDraft[`${l.draftId}:${k}`] ?? l[k]}
                        aria-invalid={strengthErrors.current.has(
                          `${l.draftId}:${k}`,
                        )}
                        onChange={(e) => {
                          const text = e.target.value;
                          editRevision.current++;
                          setStrengthDraft((current) => ({
                            ...current,
                            [`${l.draftId}:${k}`]: text,
                          }));
                          if (
                            !text.trim() ||
                            !Number.isFinite(Number(text)) ||
                            Number(text) < -20 ||
                            Number(text) > 20
                          ) {
                            strengthErrors.current.set(
                              `${l.draftId}:${k}`,
                              "LoRA 强度须为 −20 至 20",
                            );
                            setError("LoRA 强度须为 −20 至 20");
                            void reportInvalid(
                              "models",
                              "LoRA 强度须为 −20 至 20",
                            );
                          } else {
                            strengthErrors.current.delete(`${l.draftId}:${k}`);
                            void update("lora", {
                              loras: modelsRef.current.lora.loras.map((x) =>
                                x.draftId === l.draftId
                                  ? { ...x, [k]: Number(text) }
                                  : x,
                              ),
                            });
                          }
                        }}
                      />
                    ))}
                    <Switch
                      checked={l.active}
                      label={`启用 LoRA ${l.name}`}
                      onChange={(v) =>
                        void update("lora", {
                          loras: modelsRef.current.lora.loras.map((x) =>
                            x.draftId === l.draftId ? { ...x, active: v } : x,
                          ),
                        })
                      }
                    />
                    <div className="inline-actions">
                      <IconButton
                        icon={ArrowUp}
                        label={`上移 ${l.name}`}
                        disabled={i === 0}
                        onClick={() => reorder(i, i - 1)}
                      />
                      <IconButton
                        icon={ArrowDown}
                        label={`下移 ${l.name}`}
                        disabled={i === models.lora.loras.length - 1}
                        onClick={() => reorder(i, i + 1)}
                      />
                      <IconButton
                        icon={Trash}
                        label={`移除 ${l.name}`}
                        onClick={() =>
                          void update("lora", {
                            loras: modelsRef.current.lora.loras.filter(
                              (x) => x.draftId !== l.draftId,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                ),
            )}
            {!models.lora.loras.length && (
              <Empty
                title="尚未添加 LoRA"
                description="读取节点与模型后，从列表选择模型，或浏览 LoRA 模型库。"
              />
            )}
          </div>
          <div className="controller-add">
            <ModelPicker value={picker} options={catalog.loras} onChange={setPicker} />
            <IconButton
              icon={Plus}
              label="添加 LoRA"
              disabled={!catalog.loras.includes(picker)}
              onClick={() => {
                void update("lora", {
                  loras: [
                    ...modelsRef.current.lora.loras,
                    {
                      name: picker,
                      strength: 1,
                      clipStrength: 1,
                      active: true,
                    },
                  ],
                });
                setPicker("");
              }}
            />
          </div>
          <p className="controller-count hint">
            {models.lora.loras.length} 个 LoRA ·{" "}
            {models.lora.loras.filter((l) => l.active).length} 个启用
          </p>
          {error && (
            <Notice error>
              <p>{error}</p>
              <button onClick={() => void discard()}>放弃未保存的修改</button>
            </Notice>
          )}
        </Panel>
        <div className="model-loaders">
          {loader("unet")}
          {loader("vae")}
        </div>
        <div className="model-notice">
          <Notice>
            模型资料与控制器分别保存；添加模型前需核对 ComfyUI 标识。
          </Notice>
        </div>
      </div>
    </div>
  );
}
