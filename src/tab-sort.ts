import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { animateMotion, reducedMotion, visualCopy } from "./motion";

function fixedPromptTab(id: string) {
  return id === "positive" || id === "negative";
}

export function useTabSort(
  ref: RefObject<HTMLDivElement | null>,
  tabs: string[],
  commit: (order: string[]) => void,
  ready: boolean,
) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const current = useRef({ tabs, commit });
  current.current = { tabs, commit };

  useEffect(() => {
    const root = ref.current;
    if (!ready || !root) return;
    let drag: {
      element: HTMLElement;
      id: string;
      pointer: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      bounds: DOMRect;
      original: string[];
      order: string[];
      ghost: HTMLElement | null;
      frame: number;
    } | null = null;
    let suppressClick = false;
    const animations = new Map<HTMLElement, Animation>();
    const items = () => [
      ...root.querySelectorAll<HTMLElement>(
        ":scope > [data-tab-id]:not([data-motion-exit])",
      ),
    ];

    const stopAnimations = () => {
      for (const animation of animations.values()) animation.cancel();
      animations.clear();
    };
    const reflow = (order: string[] | null, save = false) => {
      const neighbors = items().filter((tab) => tab !== drag?.element);
      const before = neighbors.map((tab) => tab.getBoundingClientRect().left);
      stopAnimations();
      flushSync(() => {
        if (save && order) current.current.commit(order);
        setPreview(save ? null : order);
      });
      if (reducedMotion()) return;
      neighbors.forEach((tab, i) => {
        const delta = before[i] - tab.getBoundingClientRect().left;
        if (Math.abs(delta) < 0.5) return;
        animations.set(
          tab,
          animateMotion(
            tab,
            [{ transform: `translateX(${delta}px)` }, { transform: "none" }],
            160,
          ),
        );
      });
    };
    const finish = (save: boolean) => {
      if (!drag) return;
      cancelAnimationFrame(drag.frame);
      if (drag.ghost) {
        suppressClick = true;
        reflow(save ? drag.order : null, save);
        drag.ghost.remove();
        delete drag.element.dataset.tabPlaceholder;
        delete root.dataset.tabSorting;
      }
      drag = null;
    };
    const tick = () => {
      if (!drag?.ghost) return;
      if (drag.original !== current.current.tabs) {
        finish(false);
        return;
      }
      const { x, y, startX, startY, bounds } = drag;
      drag.ghost.style.transform = `translate(${x - startX}px, ${y - startY}px)`;
      const strip = root.getBoundingClientRect();
      if (y >= strip.top - 12 && y <= strip.bottom + 12) {
        if (x < strip.left + 32) root.scrollLeft -= 10;
        else if (x > strip.right - 32) root.scrollLeft += 10;
        const center = bounds.left + x - startX + bounds.width / 2;
        const rest = items().filter(
          (tab) => tab !== drag?.element && !fixedPromptTab(tab.dataset.tabId!),
        );
        const index = rest.filter(
          (tab) =>
            center >
            strip.left +
              root.clientLeft +
              tab.offsetLeft -
              root.scrollLeft +
              tab.offsetWidth / 2,
        ).length;
        const order = rest.map((tab) => tab.dataset.tabId!);
        order.splice(index, 0, drag.id);
        order.unshift(...drag.original.filter(fixedPromptTab));
        if (order.some((id, i) => id !== drag!.order[i])) {
          drag.order = order;
          reflow(order);
        }
      }
      drag.frame = requestAnimationFrame(tick);
    };
    const down = (event: PointerEvent) => {
      suppressClick = false;
      const target = event.target as HTMLElement;
      const element = target.closest<HTMLElement>("[data-tab-id]");
      const id = element?.dataset.tabId;
      if (
        !element ||
        !id ||
        fixedPromptTab(id) ||
        event.button !== 0 ||
        !event.isPrimary ||
        target.closest(".icon-button") ||
        drag
      )
        return;
      drag = {
        element,
        id,
        pointer: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        bounds: element.getBoundingClientRect(),
        original: current.current.tabs,
        order: current.current.tabs,
        ghost: null,
        frame: 0,
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (
        !drag.ghost &&
        Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 5
      ) {
        drag.ghost = visualCopy(drag.element);
        drag.ghost.classList.add("tab-sort-ghost");
        delete drag.ghost.dataset.tabId;
        root.dataset.tabSorting = "true";
        drag.element.dataset.tabPlaceholder = "true";
        tick();
      }
    };
    const up = (event: PointerEvent) => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const strip = root.getBoundingClientRect();
      const save =
        !!drag.ghost &&
        drag.original === current.current.tabs &&
        event.clientX >= strip.left &&
        event.clientX <= strip.right &&
        event.clientY >= strip.top - 12 &&
        event.clientY <= strip.bottom + 12;
      if (save) {
        cancelAnimationFrame(drag.frame);
        drag.x = event.clientX;
        drag.y = event.clientY;
        tick();
      }
      finish(save);
    };
    const cancel = () => finish(false);
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag?.ghost) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || !event.detail) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("click", click, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("click", click, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
      if (drag) {
        cancelAnimationFrame(drag.frame);
        drag.ghost?.remove();
      }
      stopAnimations();
    };
  }, [ref, ready]);

  return preview ?? tabs;
}
