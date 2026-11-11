import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  animateMotion,
  pointerMotion,
  reducedMotion,
  visualCopy,
} from "./motion";

export function CollapsibleGroup({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [present, setPresent] = useState(open);
  const wasOpen = useRef(open);
  // React only supplies the initial height. Subsequent renders (including RPC
  // acknowledgements) must not overwrite a height transition in progress.
  const initialStyle = useRef({ height: open ? "auto" : 0 });
  const version = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (wasOpen.current === open) return;
    wasOpen.current = open;
    const current = ++version.current;
    const from = el.getBoundingClientRect().height;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.height = open ? "auto" : "0px";
    const to = open ? el.scrollHeight : 0;
    const finish = () => {
      // Cancelling an old direction rejects its finished promise. That callback
      // cannot unmount content belonging to a newer direction.
      if (!mounted.current || version.current !== current) return;
      el.style.height = open ? "auto" : "0px";
      delete el.dataset.collapsing;
      setPresent(open);
    };
    if (!pointerMotion() || reducedMotion() || Math.abs(from - to) < 0.5) {
      finish();
      if (pointerMotion() && reducedMotion() && to > 0)
        animateMotion(el, [{ opacity: 0.35 }, { opacity: 1 }], 80);
      return;
    }
    el.dataset.collapsing = "true";
    const animation = animateMotion(
      el,
      [{ height: from + "px" }, { height: to + "px" }],
      open ? 260 : 200,
      "cubic-bezier(0.4,0,0.2,1)",
    );
    if (open) animateMotion(el, [{ opacity: 0.35 }, { opacity: 1 }], 160);
    animation.finished.then(finish, finish);
  }, [open]);
  useLayoutEffect(() => {
    mounted.current = true;
    const el = ref.current;
    return () => {
      mounted.current = false;
      ++version.current;
      el?.getAnimations().forEach((a) => a.cancel());
    };
  }, []);
  return (
    <div
      ref={ref}
      className="group-members"
      inert={!open}
      aria-hidden={!open}
      style={initialStyle.current}
    >
      {(open || present) && children}
    </div>
  );
}

export function useTermPageMotion(
  ref: RefObject<HTMLElement | null>,
  hidden: boolean,
  workspace: boolean,
) {
  const previous = useRef({ hidden, workspace });
  const outgoing = useRef<HTMLElement | null>(null);
  // Only an explicit effective/hidden page switch opts keyboard input into
  // motion. Other keyboard navigation keeps its existing immediate response.
  const animateNextSwitch = useRef(false);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { hidden, workspace };
    const requested = animateNextSwitch.current;
    animateNextSwitch.current = false;
    const el = ref.current;
    if (old.workspace !== workspace) {
      outgoing.current?.remove();
      outgoing.current = null;
    }
    if (!el || old.hidden === hidden || old.workspace !== workspace) return;
    el.getAnimations().forEach((a) => a.cancel());
    if (!pointerMotion() && !requested) return;
    const copy = outgoing.current;
    if (copy) {
      const animation = animateMotion(
        copy,
        reducedMotion()
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: `translateX(${hidden ? -24 : 24}px)` },
            ],
        reducedMotion() ? 80 : 120,
      );
      animation.finished.then(
        () => copy.remove(),
        () => copy.remove(),
      );
    }
    animateMotion(
      el,
      reducedMotion()
        ? [{ opacity: 0.3 }, { opacity: 1 }]
        : [
            { opacity: 0.3, transform: `translateX(${hidden ? 24 : -24}px)` },
            { opacity: 1, transform: "none" },
          ],
      reducedMotion() ? 80 : 180,
    );
  }, [hidden, workspace, ref]);
  useLayoutEffect(() => () => outgoing.current?.remove(), []);
  return () => {
    outgoing.current?.remove();
    outgoing.current = null;
    if (!ref.current) return;
    animateNextSwitch.current = true;
    const copy = visualCopy(ref.current);
    copy.classList.add("term-page-exit");
    copy.scrollTop = ref.current.scrollTop;
    outgoing.current = copy;
  };
}

export function useMovingIndicator(
  ref: RefObject<HTMLElement | null>,
  selector: string,
  selection: string,
) {
  const controller = useRef<{
    root: HTMLElement;
    measure: () => void;
    dispose: () => void;
  } | null>(null);
  void selection;
  useLayoutEffect(() => {
    const root = ref.current;
    if (controller.current?.root === root) {
      controller.current?.measure();
      return;
    }
    controller.current?.dispose();
    controller.current = null;
    if (!root) return;
    const indicator = document.createElement("span");
    indicator.className = "moving-selection";
    indicator.setAttribute("aria-hidden", "true");
    root.prepend(indicator);
    root.dataset.movingSelection = "true";
    let last: DOMRect | null = null;
    let target: Element | null = null;
    const measure = (move = false) => {
      const next = root.querySelector<HTMLElement>(selector);
      if (!next) {
        indicator.hidden = true;
        last = null;
        return;
      }
      indicator.hidden = false;
      const bounds = root.getBoundingClientRect(),
        rect = next.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        indicator.hidden = true;
        last = null;
        return;
      }
      if (
        target === next &&
        last &&
        last.left === rect.left &&
        last.top === rect.top &&
        last.width === rect.width &&
        last.height === rect.height
      )
        return;
      const before = indicator.getBoundingClientRect();
      indicator.getAnimations().forEach((a) => a.cancel());
      Object.assign(indicator.style, {
        left: `${rect.left - bounds.left + root.scrollLeft}px`,
        top: `${rect.top - bounds.top + root.scrollTop}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      if (move && last && target !== next && pointerMotion()) {
        animateMotion(
          indicator,
          reducedMotion()
            ? [{ opacity: 0.4 }, { opacity: 1 }]
            : [
                {
                  transform: `translate(${before.left - rect.left}px,${before.top - rect.top}px) scale(${before.width / rect.width},${before.height / rect.height})`,
                },
                { transform: "none" },
              ],
          reducedMotion() ? 80 : 180,
        );
      }
      last = rect;
      target = next;
    };
    measure();
    const observer = new MutationObserver(() => measure(true));
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected", "class"],
      childList: true,
    });
    const resize = new ResizeObserver(() => measure());
    resize.observe(root);
    root.addEventListener("scroll", measureScroll, true);
    function measureScroll() {
      measure();
    }
    controller.current = {
      root,
      measure: () => measure(true),
      dispose: () => {
        observer.disconnect();
        resize.disconnect();
        root.removeEventListener("scroll", measureScroll, true);
        indicator.getAnimations().forEach((a) => a.cancel());
        indicator.remove();
        delete root.dataset.movingSelection;
      },
    };
  });
  useLayoutEffect(() => () => controller.current?.dispose(), []);
}
