import { tr } from "./i18n";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebview, Webview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";

/** A native child view navigates as a top-level document, unlike a cross-site iframe. */
export function ComfyNativeView({
  url,
  active,
}: {
  url: string;
  active: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const synchronize = useRef<() => void>(() => {});
  const [opened, setOpened] = useState(active);
  const [error, setError] = useState("");
  useEffect(() => {
    if (active) setOpened(true);
    synchronize.current();
  }, [active]);
  useEffect(() => {
    if (!isTauri() || !opened) return;
    let disposed = false,
      ready = false,
      frame = 0,
      signature = "";
    let work = Promise.resolve();
    setError("");
    let view: Webview | null = null;
    const label = `comfy-${crypto.randomUUID()}`;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        work = work
          .then(async () => {
            if (!ready || !view || disposed || !host.current) return;
            const r = host.current.getBoundingClientRect();
            // Native child views sit above HTML. Hide them for editor dialogs and menus.
            const visible =
              activeRef.current &&
              r.width > 0 &&
              r.height > 0 &&
              !document.querySelector(".modal-overlay, .menu");
            const next = JSON.stringify([visible, r.x, r.y, r.width, r.height]);
            if (signature === next) return;
            if (!visible) await view.hide();
            else {
              await view.setPosition(new LogicalPosition(r.x, r.y));
              await view.setSize(new LogicalSize(r.width, r.height));
              if (!disposed) await view.show();
            }
            signature = next;
            if (!disposed && host.current)
              host.current.dataset.nativeVisibility = visible
                ? "visible"
                : "hidden";
          })
          .catch((e) => {
            if (!disposed) setError(String(e));
          });
      });
    };
    synchronize.current = sync;
    const resize = new ResizeObserver(sync);
    resize.observe(host.current!);
    const mutation = new MutationObserver(sync);
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
    });
    window.addEventListener("resize", sync);
    void (async () => {
      await invoke("create_comfy_webview", { label, url });
      view = await Webview.getByLabel(label);
      if (!view) throw Error(tr("ComfyUI 内置网页创建失败"));
      if (disposed) {
        await view.close().catch(() => {});
        return;
      }
      ready = true;
      await getCurrentWebview()
        .setAutoResize(true)
        .catch((e) => setError(String(e)));
      sync();
    })().catch((e) => {
      if (!disposed) setError(String(e));
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", sync);
      synchronize.current = () => {};
      if (ready) {
        void work.finally(() => view?.close().catch(() => {}));
      }
    };
  }, [url, opened]);
  return (
    <div ref={host} className="comfy-native-host" aria-label={tr("ComfyUI 内置网页")}>
      {error && <p role="alert">{tr("内置网页加载失败：")}{error}</p>}
    </div>
  );
}
