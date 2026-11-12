import { tr, trDiagnostic } from "./i18n";
import { useSurfaceMotion } from "./motion";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  Children,
  Fragment,
  isValidElement,
  cloneElement,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Info,
  FolderOpen,
  ClipboardText,
  CaretLeft,
  CaretRight,
  Plus,
  Trash,
  ImageSquare,
  ArrowsOut,
} from "@phosphor-icons/react";
import { pick, imageUrl, rpc, bytesBase64 } from "./api";
import { useApp } from "./context";
// Render outside scroll/clip containers and keep every edge inside the viewport.
export function useTooltip(content: ReactNode) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const hide = () => {
    clearTimeout(timer.current);
    setAnchor(null);
    setPosition(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const measure = () => {
      if (!ref.current) return;
      const { width, height } = ref.current.getBoundingClientRect();
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.right - width, innerWidth - width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            anchor.bottom + 8 + height <= innerHeight - 8
              ? anchor.bottom + 8
              : anchor.top - height - 8,
            innerHeight - height - 8,
          ),
        ),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target))
        hide();
    };
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("keydown", escape);
    };
  }, [anchor]);
  const show = (e: { currentTarget: HTMLElement }) => {
    clearTimeout(timer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    timer.current = setTimeout(() => setAnchor(rect), 400);
  };
  return {
    show,
    focus: (e: { currentTarget: HTMLElement }) => {
      if (
        document.documentElement.dataset.focusInput === "keyboard" &&
        e.currentTarget.matches(":focus-visible")
      )
        show(e);
    },
    hide,
    leave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(hide, 150);
    },
    describedBy: anchor ? id : undefined,
    tooltip:
      anchor &&
      createPortal(
        <div
          id={id}
          ref={ref}
          role="tooltip"
          className="floating-tooltip"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={hide}
          style={{ ...position, visibility: position ? "visible" : "hidden" }}
        >
          {content}
        </div>,
        document.body,
      ),
  };
}
export function PageLabelButton({
  label,
  shortLabel = label,
  icon,
  count,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  shortLabel?: string;
  icon: ReactNode;
  count?: number;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const tip = useTooltip(label);
  const needsTooltip = () => {
    const node = text.current;
    return label !== shortLabel || !node?.offsetWidth || node.scrollWidth > node.clientWidth;
  };
  return (
    <>
      <button
        type="button"
        {...props}
        aria-label={label}
        aria-describedby={tip.describedBy}
        onPointerEnter={(event) => { if (needsTooltip()) tip.show(event); }}
        onPointerLeave={tip.leave}
        onFocus={(event) => { if (needsTooltip()) tip.focus(event); }}
        onBlur={tip.hide}
        onClick={(event) => {
          tip.hide();
          props.onClick?.(event);
        }}
      >
        {icon}
        <span className="page-button-label" ref={text}>{shortLabel}</span>
        {count != null && <small>{count}</small>}
      </button>
      {tip.tooltip}
    </>
  );
}

export function IconButton({
  icon: Icon,
  label,
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ComponentType<any>;
  label: string;
  active?: boolean;
}) {
  const tip = useTooltip(label);
  return (
    <>
      <button
        type="button"
        {...props}
        aria-label={label}
        title=""
        aria-describedby={tip.describedBy}
        onPointerEnter={(e) => {
          if (!props.disabled) tip.show(e);
          props.onPointerEnter?.(e);
        }}
        onPointerLeave={(e) => {
          tip.leave();
          props.onPointerLeave?.(e);
        }}
        onFocus={(e) => {
          if (!props.disabled) tip.focus(e);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          tip.hide();
          props.onBlur?.(e);
        }}
        onPointerDown={(e) => {
          tip.hide();
          props.onPointerDown?.(e);
        }}
        onClick={(e) => {
          tip.hide();
          props.onClick?.(e);
        }}
        aria-pressed={active}
        className={`icon-button ${active ? "active" : ""} ${className}`}
      >
        <Icon size={16} />
      </button>
      {tip.tooltip}
    </>
  );
}
export function MiddleEllipsis({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const style = getComputedStyle(el);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const chars = Array.from(text);
      const spacing = parseFloat(style.letterSpacing) || 0;
      const fits = (value: string) =>
        context.measureText(value).width +
          Math.max(0, Array.from(value).length - 1) * spacing <=
        el.clientWidth;
      const shorten = (length: number) => {
        const head = Math.ceil(length * 0.6),
          tail = length - head;
        return (
          chars.slice(0, head).join("") +
          "..." +
          (tail ? chars.slice(-tail).join("") : "")
        );
      };
      if (fits(text)) {
        setDisplay(text);
        return;
      }
      let low = 0,
        high = Math.max(0, chars.length - 1);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(shorten(middle))) low = middle;
        else high = middle - 1;
      }
      setDisplay(shorten(low));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [text]);
  return (
    <span
      ref={ref}
      className={`middle-ellipsis ${className}`}
      title={text}
      aria-label={text}
    >
      {display}
    </span>
  );
}
export function Panel({
  title,
  actions,
  children,
  className = "",
  style,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const motionRef = useRef<HTMLElement>(null);
  useSurfaceMotion(motionRef, className.includes("lookup-panel") ? "drawer" : null);
  return (
    <section ref={motionRef} id={id} className={`panel ${className}`} style={style}>
      {title && (
        <header className="panel-heading">
          <span>{title}</span>
          <div className="inline-actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}
export function Field({
  label,
  children,
  hint,
  error,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}) {
  const id = useId();
  const decorate = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement(node)) return node;
      const element = node as ReactElement<any>;
      if (
        typeof element.type === "string" &&
        ["input", "select", "textarea"].includes(element.type)
      )
        return cloneElement(element, {
          "aria-labelledby": element.props["aria-label"] ? undefined : id,
        });
      if (typeof element.type === "string" && element.props.children)
        return cloneElement(element, {
          children: decorate(element.props.children),
        });
      return node;
    });
  return (
    <div className={`field ${className}`}>
      <span id={id} className="field-label">
        {label}
      </span>
      {decorate(children)}
      {hint && <span className="hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={label}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function Segments({
  items,
  value,
  onChange,
  label,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="segments" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button
          type="button"
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Info size={26} />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <Info size={16} />
      <div>{error && typeof children === "string" ? trDiagnostic(children) : children}</div>
    </div>
  );
}
const modalLayouts: Record<string, [number, number, string]> = {
  保存提示词卡: [800, 800, "项目嵌入 PNG；图片仍可正常查看。"],
  另存提示词卡: [800, 800, "项目嵌入 PNG；图片仍可正常查看。"],
  从图片导入: [880, 904, "PNG 中的提示词卡与生成信息可逐项选择来源。"],
  创建视觉组: [800, 760, "按原文顺序收拢选中有效词；不自动加入收藏。"],
  修改视觉组: [800, 760, "修改组属性，保留成员身份和权重。"],
  收藏选中片段: [800, 760, "仅保存有效词；保存后创建 / 复用视觉组。"],
  编辑收藏片段: [800, 760, "收藏片段与已插入的视觉组分别保存。"],
  编辑内置词条: [800, 884, "本机修改独立保存；内置条目可恢复原始版本。"],
  新建内置词条: [800, 884, "新建词条独立保存在本机用户词库。"],
  复制输出预览: [800, 700, "复制全部有效项，描述组在末尾输出。"],
  管理工作流分组: [800, 800, "名称与控制器 ID 共同标识工作流分组。"],
  添加工作流分组: [800, 800, "名称与控制器 ID 共同标识工作流分组。"],
  添加尺寸预设: [660, 600, "保存自定义尺寸，宽高须为 8 的倍数。"],
  管理模型文件夹: [800, 740, "模型文件保留在原目录，支持多个来源文件夹。"],
  "新增 LoRA 链接": [720, 552, "每行一个网页地址，支持批量添加。"],
  "修改 LoRA 链接": [720, 552, "修改当前网页地址。"],
  批量添加标签: [660, 540, "将标签添加到全部选中模型。"],
  "ComfyUI 连接详情": [760, 660, "本机接口状态与最近一次实际读取结果。"],
};
// Preserve handlers, refs and fragments while giving commit labels a visual layer.
function wrapCommitLabel(node: ReactNode): ReactNode {
  if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) return node;
  if (node.type === "button" && /(?:^|\s)(?:primary|danger-button)(?:\s|$)/.test(node.props.className || "")) {
    return cloneElement(node, {}, <span className="motion-label">{node.props.children}</span>);
  }
  if (node.type === Fragment) return cloneElement(node, {}, Children.map(node.props.children, wrapCommitLabel));
  return node;
}
export function Modal({
  title,
  children,
  footer,
  onClose,
  width = 640,
  className = "",
  subtitle,
  heading,
  icon: HeadingIcon,
}: {
  title: string;
  heading?: string;
  icon?: ComponentType<any>;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  className?: string;
}) {
  const layoutKey = Object.keys(modalLayouts).find((key) => tr(key) === title);
  const layout = layoutKey ? modalLayouts[layoutKey] : undefined;
  subtitle ??= layout ? tr(layout[2]) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useSurfaceMotion(overlayRef, "modal");
  const previous = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    const first =
      ref.current?.querySelector<HTMLElement>("[data-default-focus]") ||
      ref.current?.querySelector<HTMLElement>(
        '[autofocus],input,textarea,select,button:not([data-dialog-close])',
      );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      const overlays = document.querySelectorAll(".modal-overlay");
      const confirmation = Array.from(overlays).find(overlay => overlay.querySelector(".application-confirmation"));
      if (overlayRef.current !== (confirmation || overlays.item(overlays.length - 1))) return;
      if (e.key === "Escape" && e.target instanceof HTMLElement &&
          ref.current?.contains(e.target) && e.target.dataset.completionOpen === "true") return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const all = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ) || []),
        ].filter((e) => e.offsetParent !== null);
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous.current?.focus();
    };
  }, []);
  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${layout ? "design-modal" : ""} ${className}`}
        style={{ width: layout?.[0] || width, height: layout?.[1] }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-favorite-layout={layoutKey === "收藏选中片段" || layoutKey === "编辑收藏片段" || undefined}
      >
        <header>
          {HeadingIcon && <HeadingIcon size={16} aria-hidden="true" />}
          <strong>{heading || title}</strong>
          <IconButton icon={X} label={tr("关闭弹窗")} data-dialog-close onClick={onClose} />
        </header>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        <div className="modal-body">{children}</div>
        {footer && <footer>{Children.map(footer, (child) => wrapCommitLabel(child))}</footer>}
      </div>
    </div>
  );
}
export type MenuItem = {
  icon?: ComponentType<any>;
  label: string;
  action?: () => void | Promise<void>;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  checked?: boolean;
};
export function Menu({
  items,
  x,
  y,
  width,
  className = "",
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  width?: number;
  className?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const el = ref.current!;
    let rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    el.style.transformOrigin = `${Math.max(0, Math.min(rect.width, x - parseFloat(el.style.left)))}px ${y >= parseFloat(el.style.top) + rect.height ? "100%" : "0"}`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const all = [
          ...el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        let at = all.indexOf(document.activeElement as HTMLButtonElement);
        at =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? all.length - 1
              : (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) %
                all.length;
        all[at]?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
      trigger.current?.focus();
    };
  }, []);
  useSurfaceMotion(ref, "menu");
  return (
    <div
      ref={ref}
      className={`menu ${width ? "menu-match-trigger" : ""} ${className}`}
      role="menu"
      style={{ left: x, top: y, ...(width ? { width, minWidth: 0 } : {}) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div className="menu-separator" key={i} />
        ) : (
          <button
            type="button"
            role="menuitem"
            key={i}
            disabled={item.disabled}
            className={item.danger ? "danger" : ""}
            onClick={() => {
              onClose();
              void item.action?.();
            }}
          >
            {item.icon && <item.icon size={16} aria-hidden="true" />}
            <span>
              {item.checked ? "• " : ""}
              {item.label}
            </span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
export function Toast({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSurfaceMotion(ref, "toast");
  return <div ref={ref} className="toast" role="status"><span>{children}</span><IconButton icon={X} label={tr("关闭通知")} onClick={onClose} /></div>;
}
export function PageHeading({
  title,
  description,
  actions,
  status,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  const tip = useTooltip(description);
  return (
    <div className="page-heading">
      <h1
        aria-describedby={tip.describedBy}
        onPointerEnter={tip.show}
        onPointerLeave={tip.leave}
      >
        {title}
      </h1>
      <div className="page-actions">{actions}</div>
      {tip.tooltip}
      <span className="page-status">{status}</span>
    </div>
  );
}
export function AsyncImage({
  path,
  ...props
}: { path: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!path) {
      setSrc("");
      return;
    }
    if (path.startsWith("data:") || path.startsWith("/")) {
      setSrc(path);
      return;
    }
    imageUrl(path)
      .then((s) => {
        if (live) setSrc(s);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [path]);
  return failed ? (
    <span className="image-missing">{tr("图片文件不可用")}</span>
  ) : src ? (
    <img {...props} src={src} />
  ) : (
    <span className="image-loading">{tr("读取图片…")}</span>
  );
}
export function useNativeImageDrop(
  ref: React.RefObject<HTMLElement | null>,
  onDrop: (paths: string[]) => void,
) {
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.nativeImageDrop = "true";
    const drop = (e: Event) =>
      latest.current((e as CustomEvent<string[]>).detail);
    el.addEventListener("native-image-drop", drop);
    return () => {
      delete el.dataset.nativeImageDrop;
      el.removeEventListener("native-image-drop", drop);
    };
  }, []);
}
export function ReferenceImages({
  images,
  onChange,
  title = tr("参考图"),
  sourceImages = [],
}: {
  images: string[];
  onChange: (images: string[]) => void;
  title?: string;
  sourceImages?: string[];
}) {
  const app = useApp();
  const dropRef = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState(false);
  useEffect(
    () => setIndex((i) => Math.min(i, Math.max(0, images.length - 1))),
    [images.length],
  );
  const add = async (paths?: string[]) => {
    try {
      paths ??= await pick({
        multiple: true,
        filters: [
          { name: tr("图片"), extensions: ["png", "jpg", "jpeg", "webp", "bmp"] },
        ],
      }).then((p) => (Array.isArray(p) ? p : p ? [p] : []));
      const next = [...images];
      for (const path of paths || []) {
        const rel = await rpc<string>("reference.import", { path });
        if (!next.includes(rel)) next.push(rel);
      }
      onChange(next);
      setIndex(next.length - 1);
    } catch (e) {
      app.reportError(String(e));
    }
  };
  const paste = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const base64 = await bytesBase64(await item.getType(type));
          const relative = await rpc<string>("reference.import", { base64 });
          if (!images.includes(relative)) {
            onChange([...images, relative]);
            setIndex(images.length);
          }
          return;
        }
      }
      app.notify(tr("剪贴板中没有图片"));
    } catch (e) {
      app.reportError(String(e));
    }
  };
  useNativeImageDrop(dropRef, (paths) => void add(paths));
  const importFiles = async (files: File[]) => {
    try {
      const next = [...images];
      for (const file of files.filter((f) => f.type.startsWith("image/"))) {
        const rel = await rpc<string>("reference.import", {
          base64: await bytesBase64(file),
        });
        if (!next.includes(rel)) next.push(rel);
      }
      onChange(next);
      setIndex(next.length - 1);
    } catch (e) {
      app.reportError(String(e));
    }
  };
  return (
    <section
      ref={dropRef}
      className="reference-images"
      tabIndex={0}
      onPaste={(e) => {
        if (e.clipboardData.files.length) {
          e.preventDefault();
          void importFiles([...e.clipboardData.files]);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="reference-toolbar">
        <span>
          {title} {images.length > 0 && `· ${index + 1} / ${images.length}`}
        </span>
        <div className="inline-actions">
          <IconButton icon={Plus} label={tr("选择参考图片")} onClick={() => add()} />
          <IconButton
            icon={ClipboardText}
            label={tr("粘贴参考图片")}
            onClick={paste}
          />
          {sourceImages.length > 0 && (
            <IconButton
              icon={FolderOpen}
              label={tr("导入同名参考图")}
              onClick={() => add(sourceImages)}
            />
          )}
          <IconButton
            icon={ImageSquare}
            label={tr("设当前图片为封面")}
            disabled={!images.length || index === 0}
            onClick={() => {
              onChange([
                images[index],
                ...images.filter((_, i) => i !== index),
              ]);
              setIndex(0);
            }}
          />
          <IconButton
            icon={ArrowsOut}
            label={tr("放大查看参考图")}
            disabled={!images.length}
            onClick={() => setViewer(true)}
          />
          <IconButton
            icon={Trash}
            label={tr("移除此参考图")}
            disabled={!images.length}
            onClick={() => onChange(images.filter((_, i) => i !== index))}
          />
        </div>
      </div>
      <div className="reference-banner">
        {images.length ? (
          <AsyncImage
            path={images[index]}
            alt={tr("参考图 {0}", index + 1)}
            onDoubleClick={() => setViewer(true)}
          />
        ) : (
          <div className="reference-placeholder">
            <ImageSquare size={28} />
            <span>{tr("拖入、粘贴或选择参考图片")}</span>
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="reference-pagination">
          <IconButton
            icon={CaretLeft}
            label={tr("上一张参考图")}
            onClick={() =>
              setIndex((index - 1 + images.length) % images.length)
            }
          />
          <span>
            {index + 1} / {images.length}
          </span>
          <IconButton
            icon={CaretRight}
            label={tr("下一张参考图")}
            onClick={() => setIndex((index + 1) % images.length)}
          />
        </div>
      )}
      {viewer && (
        <Modal
          title={tr("参考图查看器")}
          width={1080}
          onClose={() => setViewer(false)}
          footer={
            <>
              <span className="muted">{tr("滚轮缩放 · 双击适应窗口 · Esc 关闭")}</span>
              <span className="spacer" />
              <IconButton
                icon={CaretLeft}
                label={tr("上一张")}
                disabled={images.length < 2}
                onClick={() =>
                  setIndex((index - 1 + images.length) % images.length)
                }
              />
              <span>
                {index + 1} / {images.length}
              </span>
              <IconButton
                icon={CaretRight}
                label={tr("下一张")}
                disabled={images.length < 2}
                onClick={() => setIndex((index + 1) % images.length)}
              />
            </>
          }
        >
          <ImageViewer path={images[index]} />
        </Modal>
      )}
    </section>
  );
}
function ImageViewer({ path }: { path: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [path]);
  return (
    <div
      className="image-viewer"
      onWheel={(e) =>
        setZoom((z) =>
          Math.max(0.1, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))),
        )
      }
      onDoubleClick={() => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          ox: offset.x,
          oy: offset.y,
        };
      }}
      onPointerMove={(e) => {
        if (drag.current)
          setOffset({
            x: drag.current.ox + e.clientX - drag.current.x,
            y: drag.current.oy + e.clientY - drag.current.y,
          });
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <AsyncImage
        path={path}
        alt={tr("参考图")}
        draggable={false}
        style={{
          transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})`,
        }}
      />
    </div>
  );
}
