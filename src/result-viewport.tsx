import { tr } from "./i18n";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/** A shared pixel-based camera. Comparison layers receive the same transform. */
export function ResultViewport({
  width,
  height,
  compare = false,
  onScrub,
  children,
  overlay,
}: {
  width: number;
  height: number;
  compare?: boolean;
  onScrub?: (x: number, left: number, width: number) => void;
  children: (style: CSSProperties) => ReactNode;
  overlay?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [image, setImage] = useState({
    width: width || 1,
    height: height || 1,
  });
  const decoded = useRef(new Map<string, { width: number; height: number }>());
  const [camera, setCamera] = useState({
    scale: null as number | null,
    x: 0,
    y: 0,
  });
  const [space, setSpace] = useState(false);
  const spaceHeld = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    ox: number;
    oy: number;
    pan: boolean;
  } | null>(null);
  const fit = Math.min(size.width / image.width, size.height / image.height);
  const scale = camera.scale ?? fit;
  const zoom = (factor: number, x = 0, y = 0) =>
    setCamera((c) => {
      const previous = c.scale ?? fit;
      const next = Math.max(
        Math.min(fit, 0.05),
        Math.min(16, previous * factor),
      );
      return {
        scale: next,
        x: x - ((x - c.x) * next) / previous,
        y: y - ((y - c.y) * next) / previous,
      };
    });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const reset = () => setCamera({ scale: null, x: 0, y: 0 });
  useEffect(() => {
    const el = stage.current!;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(
        Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.002),
        e.clientX - r.left - r.width / 2,
        e.clientY - r.top - r.height / 2,
      );
    };
    const release = () => {
      spaceHeld.current = false;
      setSpace(false);
      drag.current = null;
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.code === "Space") release();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
    };
  }, []);
  const scrub = (x: number) => {
    const r = stage.current!.getBoundingClientRect();
    onScrub?.(x, r.left, r.width);
  };
  return (
    <div className="result-viewport">
      <div className="result-viewport-tools" aria-label={tr("图片缩放工具")}>
        <button onClick={reset}>{tr("适应窗口")}</button>
        <button onClick={() => setCamera({ scale: 1, x: 0, y: 0 })}>{tr("100% 原始大小")}</button>
        <button aria-label={tr("缩小图片")} onClick={() => zoom(1 / 1.25)}>
          −
        </button>
        <output aria-label={tr("图片缩放比例")}>{Math.round(scale * 100)}%</output>
        <button aria-label={tr("放大图片")} onClick={() => zoom(1.25)}>
          ＋
        </button>
        <span>
          {compare
            ? tr("滚轮缩放 · 空格＋拖动平移 · 拖动分界线")
            : tr("滚轮缩放 · 拖动平移 · 双击适应窗口")}
        </span>
      </div>
      <div
        ref={stage}
        className={`result-viewport-stage ${compare && !space ? "scrub" : "pan"}`}
        tabIndex={0}
        aria-label={compare ? tr("对比图片画布") : tr("大图画布")}
        onLoadCapture={(e) => {
          if (e.target instanceof HTMLImageElement && e.target.naturalWidth) {
            // Use decoded pixels, not potentially stale generation settings.
            decoded.current.set(e.target.src, {
              width: e.target.naturalWidth,
              height: e.target.naturalHeight,
            });
            const sizes = [...decoded.current.values()];
            setImage({
              width: Math.max(...sizes.map((s) => s.width)),
              height: Math.max(...sizes.map((s) => s.height)),
            });
          }
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.code === "Space") {
            e.preventDefault();
            spaceHeld.current = true;
            setSpace(true);
          } else if (["+", "=", "-", "0", "1"].includes(e.key)) {
            e.preventDefault();
            if (e.key === "0") reset();
            else if (e.key === "1") setCamera({ scale: 1, x: 0, y: 0 });
            else zoom(e.key === "-" ? 1 / 1.25 : 1.25);
          }
        }}
        onDoubleClick={reset}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if ((e.target as Element).closest(".result-navigation")) return;
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const pan = !compare || spaceHeld.current || e.button === 1;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            ox: camera.x,
            oy: camera.y,
            pan,
          };
          if (!pan) scrub(e.clientX);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (d.pan)
            setCamera((c) => ({
              ...c,
              x: d.ox + e.clientX - d.x,
              y: d.oy + e.clientY - d.y,
            }));
          else scrub(e.clientX);
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {children({
          width: image.width,
          height: image.height,
          transform: `translate(-50%, -50%) translate(${camera.x}px, ${camera.y}px) scale(${scale})`,
        })}
        {overlay}
      </div>
    </div>
  );
}

/** Each layer retains its own pixel dimensions, including mixed-size A/B results. */
export function ResultImagePlane({
  style,
  children,
}: {
  style: CSSProperties;
  children: ReactNode;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  return (
    <div
      className="result-viewport-plane"
      style={{ ...style, ...size }}
      onLoadCapture={(e) => {
        if (e.target instanceof HTMLImageElement && e.target.naturalWidth)
          setSize({
            width: e.target.naturalWidth,
            height: e.target.naturalHeight,
          });
      }}
    >
      {children}
    </div>
  );
}
