import { useState, useRef } from "react";
import {
  FolderOpen,
  ImageSquare,
  ClipboardText,
  ArrowCounterClockwise,
  FloppyDisk,
} from "@phosphor-icons/react";
import {
  Modal,
  Field,
  IconButton,
  Notice,
  AsyncImage,
  Switch,
  useNativeImageDrop,
} from "./ui";
import { useApp } from "./context";
import { pick, bytesBase64, rpc } from "./api";
export function SaveCard({
  saveAs,
  onClose,
  onSaved,
}: {
  saveAs: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const app = useApp();
  const existing = app.data.projectPath;
  const coverRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(
    existing
      ?.split(/[\\/]/)
      .at(-1)
      ?.replace(/(?:\.prompt-card)?\.png$/i, "") || "未命名项目",
  );
  const [folder, setFolder] = useState(
    existing?.replace(/[\\/][^\\/]+$/, "") ||
      app.data.dataDirectory.replace(/[\\/]data$/, "") + "\\cards",
  );
  const [cover, setCover] = useState<string | undefined>();
  const [base64, setBase64] = useState<string | undefined>();
  const [defaultCover, setDefault] = useState(false);
  const [error, setError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const paste = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          setBase64(await bytesBase64(await item.getType(type)));
          setCover(undefined);
          setDefault(false);
          return;
        }
      }
      setError("剪贴板中没有图片");
    } catch (e) {
      setError(String(e));
    }
  };
  const choose = async () => {
    try {
      const p = await pick({
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (typeof p === "string") {
        setCover(p);
        setBase64(undefined);
        setDefault(false);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async () => {
    if (!name.trim() || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) {
      setError("请输入有效卡片名称，不能包含路径或文件名保留字符");
      return;
    }
    if (!folder.trim()) {
      setError("请选择保存文件夹");
      return;
    }
    setBusy(true);
    setError("");
    setSaveFailed(false);
    try {
      const path = `${folder.replace(/[\\/]$/, "")}\\${name.trim()}.prompt-card.png`;
      const { exists } = await rpc<{ exists: boolean }>("project.save_check", { path });
      if (exists && await app.confirm({
        title: "覆盖同名项目？",
        body: <><p>此位置已有同名提示词卡，覆盖后将替换其中的提示词、参数和封面。</p><p className="break-all">{path}</p></>,
        confirm: "确认覆盖",
        cancel: "取消",
        danger: true,
      }) !== "confirm") return;
      await app.act("project.save", {
        path,
        overwrite: exists,
        coverPath: cover,
        coverBase64: base64,
        defaultCover,
        saveAs,
      });
      onSaved();
    } catch (e) {
      setError(String(e));
      setSaveFailed(true);
    } finally {
      setBusy(false);
    }
  };
  useNativeImageDrop(coverRef, (paths) => {
    if (paths.length !== 1 || !/\.png$/i.test(paths[0])) {
      setError("请选择一张 PNG 图片");
      return;
    }
    setCover(paths[0]);
    setBase64(undefined);
    setDefault(false);
  });
  return (
    <Modal
      className="save-card-dialog"
      title={saveAs ? "另存提示词卡" : "保存提示词卡"}
      width={720}
      onClose={onClose}
      footer={
        <>
          {!saveFailed && (
            <span className="hint">封面原图和其他已有文件会受到保护</span>
          )}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>
            {saveFailed ? "返回编辑" : "取消"}
          </button>
          {saveFailed && (
            <button
              onClick={() => {
                folderInput.current?.focus();
                folderInput.current?.select();
              }}
            >
              另存到其他位置
            </button>
          )}
          <button className="primary" onClick={save} disabled={busy}>
            <FloppyDisk size={16} />
            {busy ? "保存中…" : saveFailed ? "重试" : "保存提示词卡"}
          </button>
        </>
      }
    >
      <div className="save-cover-row">
        <div
          ref={coverRef}
          className="save-cover"
          tabIndex={0}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f?.type === "image/png") {
              setBase64(await bytesBase64(f));
              setCover(undefined);
              setDefault(false);
            } else setError("请选择一张 PNG 图片");
          }}
          onPaste={(e) => {
            e.preventDefault();
            void paste();
          }}
        >
          {base64 ? (
            <img src={`data:image/png;base64,${base64}`} alt="卡片封面" />
          ) : cover ? (
            <AsyncImage path={cover} alt="卡片封面" />
          ) : existing && /\.png$/i.test(existing) && !defaultCover ? (
            <AsyncImage path={existing} alt="现有卡片封面" />
          ) : (
            <img src="/icon.png" alt="默认卡片封面" />
          )}
        </div>
        <div className="cover-description">
          <h3>提示词卡图片</h3>
          <p>拖入 PNG，或按 Ctrl + V 粘贴图片。</p>
          <div className="cover-toolbar">
            <IconButton
              icon={ImageSquare}
              label="选择 PNG 封面"
              onClick={choose}
            />
            <IconButton
              icon={ClipboardText}
              label="粘贴封面图片"
              onClick={paste}
            />
            <IconButton
              icon={ArrowCounterClockwise}
              label="使用默认图片"
              onClick={() => {
                setDefault(true);
                setCover(undefined);
                setBase64(undefined);
              }}
            />
          </div>
          <p className="hint">
            保存为图片副本，封面原图不会被覆盖。
            <br />原 PNG 已有的工作流与参数会保留。
          </p>
        </div>
      </div>
      <Field label="卡片名称">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="保存文件夹">
        <div className="input-action">
          <input
            ref={folderInput}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <IconButton
            icon={FolderOpen}
            label="选择保存文件夹"
            onClick={async () => {
              try {
                const p = await pick({ directory: true });
                if (typeof p === "string") setFolder(p);
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        </div>
      </Field>
      <Notice>
        PNG 同时保存积极 / 消极提示词、隐藏项、视觉组、快照与基础生成参数。
      </Notice>
      {error && (
        <Notice error>
          {saveFailed ? (
            <>
              <p>保存失败。你的修改仍保留在编辑器中。</p>
              <details className="error-details">
                <summary>技术详情</summary>
                <pre>{error}</pre>
              </details>
            </>
          ) : (
            error
          )}
        </Notice>
      )}
    </Modal>
  );
}
type ImportInfo = {
  Card: any;
  Candidates: {
    Id: string;
    Title: string;
    Positive: string | null;
    Negative: string | null;
    Parameters: { Values: Record<string, string> };
    IsOutput: boolean;
  }[];
  Warnings: string[];
};
const keys = [
  "seed",
  "steps",
  "cfg",
  "sampler",
  "width",
  "height",
  "batch_size",
];
const labels = [
  "种子 · Seed",
  "步数 · Steps",
  "提示词引导 · CFG",
  "采样器 · Sampler",
  "宽度 · Width",
  "高度 · Height",
  "每批张数",
];
export function ImportImage({
  path,
  info,
  onClose,
}: {
  path: string;
  info: ImportInfo;
  onClose: () => void;
}) {
  const app = useApp();
  const [candidate, setCandidate] = useState(info.Candidates[0]?.Id || "");
  const c = info.Candidates.find((c) => c.Id === candidate);
  const [positive, setPositive] = useState(
    info.Card ? "card" : c?.Positive != null ? "comfy" : "none",
  );
  const [negative, setNegative] = useState(
    info.Card ? "card" : c?.Negative != null ? "comfy" : "none",
  );
  const [parameters, setParameters] = useState(true);
  const [sources, setSources] = useState<Record<string, string>>(
    Object.fromEntries(
      keys.map((k) => [
        k,
        info.Card?.Parameters?.Values?.[k] != null
          ? "card"
          : c?.Parameters.Values[k] != null
            ? "comfy"
            : "none",
      ]),
    ),
  );
  const [fullCard, setFullCard] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const payload = {
    path,
    candidate,
    positiveSource: positive,
    negativeSource: negative,
    parametersEnabled: parameters,
    parameterSources: sources,
    fullCard,
  };
  const apply = async () => {
    setBusy(true);
    try {
      const overwrite = await app.act<string[]>("image.plan", payload);
      if (overwrite.length) {
        const answer = await app.confirm({
          title: "确认覆盖导入内容",
          body: (
            <>
              <p>下列内容将被替换：</p>
              <ul>
                {overwrite.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="hint">导入后可通过撤销恢复工作区内容。</p>
            </>
          ),
          confirm: "确认导入",
        });
        if (answer !== "confirm") return;
      }
      await app.act("image.apply", payload);
      onClose();
      app.open(positive !== "none" ? "positive" : "negative");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const sourceSelect = (
    value: string,
    onChange: (s: string) => void,
    card: boolean,
    comfy: boolean,
    disabled = false,
  ) => (
    <select
      aria-label="导入内容来源"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={fullCard || disabled}
    >
      <option value="none">不导入</option>
      {card && <option value="card">提示词卡</option>}
      {comfy && <option value="comfy">ComfyUI / Image Saver</option>}
    </select>
  );
  return (
    <Modal
      title="从图片导入"
      className="import-image-dialog"
      subtitle={
        "已读取 " + path.split(/[\\/]/).at(-1) + "；逐项选择要导入的内容。"
      }
      onClose={onClose}
      footer={
        <>
          {info.Card && (
            <label className="inline-label hint">
              <Switch
                checked={fullCard}
                onChange={setFullCard}
                label="打开完整提示词卡"
              />
              完整提示词卡（含快照）
            </label>
          )}
          <span className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={apply} disabled={busy}>
            {busy ? "导入中…" : "导入所选"}
          </button>
        </>
      }
    >
      <Field label="生成节点">
        <select
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
          disabled={!info.Candidates.length}
        >
          {!info.Candidates.length && <option value="">提示词卡</option>}
          {info.Candidates.map((c) => (
            <option key={c.Id} value={c.Id}>
              {c.Title}
              {c.IsOutput ? " · 图片输出链" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="import-prompts">
        {[
          {
            label: "积极提示词",
            value: positive,
            set: setPositive,
            neg: false,
          },
          { label: "消极提示词", value: negative, set: setNegative, neg: true },
        ].map(({ label, value, set, neg }) => {
          const card =
            info.Card?.Project.State[neg ? "Negative" : "Positive"].Text;
          const comfy = neg ? c?.Negative : c?.Positive;
          return (
            <div className="import-prompt" key={label}>
              <div className="import-prompt-heading">
                <label>
                  <input
                    type="checkbox"
                    checked={value !== "none"}
                    disabled={fullCard || (card == null && comfy == null)}
                    onChange={(e) =>
                      set(
                        e.target.checked
                          ? card != null
                            ? "card"
                            : "comfy"
                          : "none",
                      )
                    }
                  />
                  {label}
                </label>
                {sourceSelect(value, set, card != null, comfy != null)}
              </div>
              <pre>
                {value === "card"
                  ? card
                  : value === "comfy"
                    ? comfy
                    : "未选择导入"}
              </pre>
            </div>
          );
        })}
      </div>
      <label className="import-parameter-switch">
        <input
          type="checkbox"
          checked={parameters}
          disabled={fullCard}
          onChange={(e) => setParameters(e.target.checked)}
        />
        基础生成参数
      </label>
      <div className="import-parameters">
        {keys.map((key, i) => {
          const card = info.Card?.Parameters?.Values?.[key];
          const comfy = c?.Parameters.Values[key];
          const value = sources[key];
          return (
            <div className="import-parameter-row" key={key}>
              <label>
                <input
                  type="checkbox"
                  disabled={
                    fullCard || !parameters || (card == null && comfy == null)
                  }
                  checked={parameters && value !== "none"}
                  onChange={(e) =>
                    setSources({
                      ...sources,
                      [key]: e.target.checked
                        ? card != null
                          ? "card"
                          : "comfy"
                        : "none",
                    })
                  }
                />
                {labels[i]}
              </label>
              <code>
                {value === "card" ? card : value === "comfy" ? comfy : "—"}
              </code>
              {sourceSelect(
                value,
                (s) => setSources({ ...sources, [key]: s }),
                card != null,
                comfy != null,
                !parameters,
              )}
            </div>
          );
        })}
      </div>
      <p className="hint">仅导入勾选项；覆盖已有内容前再次确认。</p>
      {info.Warnings.map((w) => (
        <Notice key={w} error>
          {w}
        </Notice>
      ))}
      {!info.Card && !info.Candidates.length && (
        <Notice error>这张图片没有可导入的提示词卡或 ComfyUI 生成信息。</Notice>
      )}
      {error && <Notice error>{error}</Notice>}
    </Modal>
  );
}
