import { useLayoutEffect, useRef, type RefObject } from "react";

export const motionEase = "cubic-bezier(0, 0, 0.58, 1)";
export {
  animate as animateMotion,
  reduced as reducedMotion,
  pointer as pointerMotion,
};
const active = new Set<Animation>();
const ghosts = new Map<string, () => void>();
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const pointer = () => document.documentElement.dataset.focusInput === "pointer";

function animate(
  el: HTMLElement,
  frames: Keyframe[],
  duration: number,
  easing = motionEase,
) {
  const animation = el.animate(frames, { duration, easing });
  active.add(animation);
  animation.finished.then(
    () => active.delete(animation),
    () => active.delete(animation),
  );
  return animation;
}

// A keyboard action must never inherit a pointer animation still in flight.
function settle() {
  active.forEach((animation) => animation.cancel());
  active.clear();
  [...ghosts.values()].forEach((remove) => remove());
}
window.addEventListener(
  "keydown",
  (event) => {
    if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) settle();
  },
  true,
);
matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
  "change",
  settle,
);

export function visualCopy(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  copy.dataset.motionExit = "true";
  [copy, ...copy.querySelectorAll<HTMLElement>("*")].forEach((node) => {
    node.removeAttribute("id");
    node.removeAttribute("role");
    node.removeAttribute("aria-modal");
    node.removeAttribute("autofocus");
  });
  const rect = el.getBoundingClientRect();
  Object.assign(copy.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    minHeight: "0",
    maxHeight: "none",
    maxWidth: "none",
    transform: "none",
    pointerEvents: "none",
    zIndex: "150",
  });
  // Keep theme and scoped component styles without leaving a live React node.
  const host = el.parentElement || document.body;
  host.appendChild(copy);
  return copy;
}

type SurfaceKind = "modal" | "menu" | "drawer" | "toast";
const surfaces = {
  modal: { enter: 200, exit: 140, transform: "scale(.985)" },
  menu: { enter: 150, exit: 100, transform: "scale(.98)" },
  drawer: { enter: 180, exit: 120, transform: "translateX(8px)" },
  toast: { enter: 160, exit: 120, transform: "translateY(6px)" },
};

export function useSurfaceMotion(
  ref: RefObject<HTMLElement | null>,
  kind: SurfaceKind | null,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !kind) return;
    const key = `${kind}:${el.getAttribute("aria-label") || ""}`;
    ghosts.get(key)?.();
    const recipe = surfaces[kind];
    const target =
      kind === "modal" ? el.querySelector<HTMLElement>(".modal")! : el;
    const base = getComputedStyle(target).transform;
    const resting = base === "none" ? "" : base;
    if (pointer()) {
      const frames = reduced()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `${resting} ${recipe.transform}`.trim() },
            { opacity: 1, transform: base },
          ];
      animate(target, frames, reduced() ? 80 : recipe.enter);
      if (kind === "modal")
        animate(el, [{ opacity: 0 }, { opacity: 1 }], reduced() ? 80 : 160);
    }
    return () => {
      const opacity = getComputedStyle(target).opacity;
      const transform = getComputedStyle(target).transform;
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      if (!pointer() || !el.getBoundingClientRect().width) return;
      const copy = visualCopy(el);
      const copyTarget =
        kind === "modal" ? copy.querySelector<HTMLElement>(".modal")! : copy;
      // Fixed copies already include the source's transformed bounding box.
      const frames =
        kind === "modal" && !reduced()
          ? [
              { opacity, transform },
              { opacity: 0, transform: recipe.transform },
            ]
          : [{ opacity }, { opacity: 0 }];
      if (!reduced() && (kind === "drawer" || kind === "toast")) {
        frames[0] = { opacity, transform: "none" };
        frames[1] = { opacity: 0, transform: recipe.transform };
      }
      const animation = animate(
        copyTarget,
        frames,
        reduced() ? 80 : recipe.exit,
      );
      if (kind === "modal")
        animate(
          copy,
          [{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }],
          reduced() ? 80 : recipe.exit,
        );
      const remove = () => {
        copy.remove();
        animation.cancel();
        if (ghosts.get(key) === remove) ghosts.delete(key);
      };
      ghosts.set(key, remove);
      animation.finished.then(remove, remove);
    };
  }, [kind, ref]);
}

type Snapshot = { rect: DOMRect; copy: HTMLElement | null };
// Only a structural signature starts motion; filtering and other renders refresh
// the baseline without animating. Stable IDs preserve row identity and drafts.
export function useListMotion(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  signature: string,
  context: string,
  duration = 160,
  maxDistance = Infinity,
  exits = true,
  nested = false,
  entrances = true,
) {
  const previous = useRef<{
    signature: string;
    context: string;
    rows: Map<string, Snapshot>;
  } | null>(null);
  const ownedGhosts = useRef(new Set<() => void>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const old = previous.current;
    const elements = [...root.querySelectorAll<HTMLElement>(selector)];
    // Height-driven collapse already moves following rows in normal flow.
    // Never start a second FLIP from an intermediate height or replay its exits.
    if (
      (old && old.context !== context) ||
      (nested && root.querySelector("[data-collapsing]"))
    ) {
      elements.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      [...ownedGhosts.current].forEach((remove) => remove());
      previous.current = null;
      return;
    }
    const changed =
      !!old &&
      old.signature !== signature &&
      old.context === context &&
      pointer();
    const rows = new Map<string, Snapshot>();
    const offsets = new Map(
      elements.map((el) => [
        el,
        new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
      ]),
    );
    if (changed)
      elements.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    const plans = elements.map((el) => {
      const id = el.dataset.motionId!;
      ghosts.get(`row:${id}`)?.();
      const before = old?.rows.get(id);
      const parent = nested
        ? el.parentElement?.closest<HTMLElement>(".visual-group")
        : null;
      const offset =
        (offsets.get(el) || 0) + (parent ? offsets.get(parent) || 0 : 0);
      const measured = el.getBoundingClientRect();
      const rect = new DOMRect(
        measured.x,
        measured.y - (changed ? 0 : offset),
        measured.width,
        measured.height,
      );
      rows.set(id, {
        rect,
        copy: exits ? (el.cloneNode(true) as HTMLElement) : null,
      });
      return { el, before, rect, offset };
    });
    if (changed) {
      for (const { el, before, rect, offset } of plans) {
        if (!before) {
          if (!entrances) continue;
          animate(
            el,
            reduced() || duration === 120
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { opacity: 0, transform: "translateY(6px)" },
                  { opacity: 1, transform: "none" },
                ],
            reduced() ? 80 : duration === 120 ? 100 : duration,
          );
        } else {
          const parent = nested
            ? el.parentElement?.closest<HTMLElement>(".visual-group")
            : null;
          const parentPlan = parent
            ? plans.find((plan) => plan.el === parent)
            : null;
          const parentDelta = parentPlan?.before
            ? parentPlan.before.rect.top +
              parentPlan.offset -
              parentPlan.rect.top
            : 0;
          const delta = before.rect.top + offset - rect.top - parentDelta;
          if (
            !reduced() &&
            !(duration === 120 && el.matches(".term-row")) &&
            Math.abs(delta) > 0.5 &&
            Math.abs(delta) <= maxDistance
          )
            animate(
              el,
              [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
              duration,
            );
        }
      }
      if (exits)
        old.rows.forEach(({ rect, copy }, id) => {
          if (rows.has(id) || !rect.width || !copy) return;
          root.appendChild(copy);
          Object.assign(copy.style, {
            position: "fixed",
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
          const ghost = visualCopy(copy);
          copy.remove();
          const key = `row:${id}`;
          ghosts.get(key)?.();
          const animation = animate(
            ghost,
            [{ opacity: 1 }, { opacity: 0 }],
            reduced() ? 80 : 120,
          );
          const remove = () => {
            ghost.remove();
            animation.cancel();
            ownedGhosts.current.delete(remove);
            if (ghosts.get(key) === remove) ghosts.delete(key);
          };
          ownedGhosts.current.add(remove);
          ghosts.set(key, remove);
          animation.finished.then(remove, remove);
        });
    }
    previous.current = { signature, context, rows };
  });
  useLayoutEffect(() => {
    const root = ref.current;
    // A scrolled/resized viewport invalidates cached screen coordinates. The
    // next edit establishes a fresh baseline instead of animating from stale rows.
    const invalidate = () => {
      previous.current = null;
    };
    root?.addEventListener("scroll", invalidate, true);
    window.addEventListener("resize", invalidate);
    return () => {
      root?.removeEventListener("scroll", invalidate, true);
      window.removeEventListener("resize", invalidate);
      root
        ?.getAnimations({ subtree: true })
        .forEach((animation) => animation.cancel());
      [...ownedGhosts.current].forEach((remove) => remove());
      previous.current = null;
    };
  }, [ref]);
}
