import { tr } from "./i18n";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { previewSort, type DragPayload, type SortIntent } from "./editor-sort";
import type { Workspace } from "./types";

export function usePointerSort(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  base: Workspace,
  preview: (value: Workspace | null) => void,
  commit: (intent: SortIntent) => Promise<unknown>,
) {
  const latest = useRef({ enabled, base, preview, commit });
  const cancelRef = useRef(() => {});
  latest.current = { enabled, base, preview, commit };
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let session: {
      id: number;
      payload: DragPayload;
      base: Workspace;
      x: number;
      y: number;
      px: number;
      py: number;
      source: HTMLElement;
      ghost: HTMLElement | null;
      offsetX: number;
      offsetY: number;
      intent: SortIntent | null;
      key: string;
      frame: number;
    } | null = null;
    let pending = false,
      suppressUntil = 0;
    const clean = (restore = true) => {
      if (session) {
        cancelAnimationFrame(session.frame);
        session.ghost?.remove();
      }
      session = null;
      root
        .querySelectorAll<HTMLElement>("[data-sort-source]")
        .forEach((el) => delete el.dataset.sortSource);
      delete root.dataset.sorting;
      if (restore) latest.current.preview(null);
    };
    const intentAt = (drag: NonNullable<typeof session>): SortIntent | null => {
      if (
        drag.px < root.getBoundingClientRect().left ||
        drag.px > root.getBoundingClientRect().right
      )
        return null;
      const hit = document.elementFromPoint(
        drag.px,
        drag.py,
      ) as HTMLElement | null;
      if (!hit || !root.contains(hit)) return null;
      const gap = hit.closest<HTMLElement>("[data-after-group]");
      const row = hit.closest<HTMLElement>(".term-row,.group-row");
      if (!gap && !row) return null;
      const gid =
        gap?.dataset.afterGroup ||
        row?.closest<HTMLElement>("[data-group-id]")?.dataset.groupId;
      const term = row?.dataset.termId || "";
      if (
        (drag.payload.group && drag.payload.group === gid) ||
        drag.payload.ids?.includes(term)
      )
        return null;
      const after =
        !!gap ||
        drag.py > row!.getBoundingClientRect().top + row!.offsetHeight / 2;
      const block = gid ? `group:${gid}` : term;
      if (drag.payload.group)
        return {
          method: "editor.group.move",
          payload: { id: drag.payload.group, target: block, after },
        };
      const groupHeader = row?.classList.contains("group-row");
      const movingNatural = drag.base.Active.some((term) =>
        term.Kind === "natural" && drag.payload.ids?.includes(term.Id),
      );
      const join =
        !gap && !movingNatural &&
        (groupHeader ? !!hit.closest(".group-name,.group-count") : !!gid);
      return {
        method: "editor.move",
        payload: {
          ids: drag.payload.ids,
          target: groupHeader || gap ? "" : term,
          group: join ? gid : null,
          block,
          after: join && groupHeader ? false : after,
        },
      };
    };
    const tick = () => {
      const drag = session;
      if (!drag?.ghost) return;
      if (!latest.current.enabled || latest.current.base !== drag.base) {
        clean();
        return;
      }
      drag.ghost.style.transform = `translate(${drag.px - drag.offsetX}px,${drag.py - drag.offsetY}px)`;
      const bounds = root.getBoundingClientRect();
      const edge =
        drag.py < bounds.top + 28
          ? -Math.min(12, (bounds.top + 28 - drag.py) / 2)
          : drag.py > bounds.bottom - 28
            ? Math.min(12, (drag.py - bounds.bottom + 28) / 2)
            : 0;
      if (edge) root.scrollTop += edge;
      const intent = intentAt(drag);
      const key = intent && JSON.stringify(intent);
      if (intent && key !== drag.key) {
        drag.intent = intent;
        drag.key = key!;
        latest.current.preview(previewSort(drag.base, intent));
      }
      // React may reparent dragged rows while crossing a group boundary.
      root
        .querySelectorAll<HTMLElement>(".term-row,.visual-group")
        .forEach((el) => {
          const source = drag.payload.group
            ? el.dataset.groupId === drag.payload.group
            : drag.payload.ids?.includes(el.dataset.termId || "");
          if (source) el.dataset.sortSource = "true";
        });
      drag.frame = requestAnimationFrame(tick);
    };
    const down = (event: PointerEvent) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>(
        ".term-handle",
      );
      if (
        !handle ||
        !root.contains(handle) ||
        !latest.current.enabled ||
        event.button !== 0 ||
        pending
      )
        return;
      const source = handle.closest<HTMLElement>(".term-row,.group-row")!;
      const group = source.classList.contains("group-row")
        ? source.closest<HTMLElement>("[data-group-id]")!
        : source;
      const payload: DragPayload = handle.dataset.dragGroup
        ? { group: handle.dataset.dragGroup }
        : { ids: JSON.parse(handle.dataset.dragIds || "[]") };
      const rect = group.getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      session = {
        id: event.pointerId,
        payload,
        base: latest.current.base,
        x: event.clientX,
        y: event.clientY,
        px: event.clientX,
        py: event.clientY,
        source: group,
        ghost: null,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        intent: null,
        key: "",
        frame: 0,
      };
    };
    const move = (event: PointerEvent) => {
      const drag = session;
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      drag.px = event.clientX;
      drag.py = event.clientY;
      if (!drag.ghost && Math.hypot(drag.px - drag.x, drag.py - drag.y) >= 5) {
        const copy = drag.source.cloneNode(true) as HTMLElement;
        copy.inert = true;
        copy.setAttribute("aria-hidden", "true");
        [copy, ...copy.querySelectorAll<HTMLElement>("*")].forEach((el) => {
          el.removeAttribute("id");
          el.removeAttribute("role");
          el.removeAttribute("data-motion-id");
          el.removeAttribute("data-term-id");
          el.removeAttribute("data-group-id");
        });
        copy.classList.add("sort-ghost");
        const rect = drag.source.getBoundingClientRect();
        Object.assign(copy.style, {
          width: `${rect.width}px`,
          maxHeight: `${root.clientHeight}px`,
        });
        root.append(copy);
        drag.ghost = copy;
        root.dataset.sorting = "true";
        if ((drag.payload.ids?.length || 0) > 1) {
          const badge = document.createElement("span");
          badge.className = "sort-count";
          badge.textContent = tr("{0} 项", drag.payload.ids!.length);
          copy.append(badge);
        }
        tick();
      }
    };
    const up = (event: PointerEvent) => {
      if (!session || session.id !== event.pointerId) return;
      const drag = session;
      if (!drag.ghost) {
        clean();
        return;
      }
      suppressUntil = performance.now() + 250;
      const rect = root.getBoundingClientRect();
      const valid =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      const intent = drag.intent;
      clean(false);
      if (!valid || !intent) {
        latest.current.preview(null);
        return;
      }
      pending = true;
      void latest.current.commit(intent).finally(() => {
        pending = false;
        latest.current.preview(null);
      });
    };
    const cancel = () => clean();
    cancelRef.current = cancel;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") clean();
    };
    const click = (event: MouseEvent) => {
      if (performance.now() < suppressUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    root.addEventListener("pointerdown", down, true);
    root.addEventListener("click", click, true);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      clean(false);
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }, [ref]);
  return () => cancelRef.current();
}
