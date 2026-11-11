/** Mouse grabbing with frame-rate independent momentum; touch keeps native scrolling. */
export function attachFilmScrolling(element: HTMLElement) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let suppressClick = false;
  let drag: {
    id: number;
    x: number;
    left: number;
    moved: boolean;
    samples: { time: number; left: number }[];
  } | null = null;

  const stopMomentum = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    element.classList.remove("is-coasting");
  };
  const cancel = () => {
    stopMomentum();
    const id = drag?.id;
    drag = null;
    element.classList.remove("is-dragging");
    if (id != null && element.hasPointerCapture(id))
      element.releasePointerCapture(id);
  };
  const coast = (velocity: number) => {
    if (motion.matches || Math.abs(velocity) < 0.015) return;
    let previous = performance.now();
    element.classList.add("is-coasting");
    const tick = (time: number) => {
      const elapsed = time - previous;
      previous = time;
      if (elapsed > 200 || document.hidden) {
        stopMomentum();
        return;
      }
      const decay = Math.exp(-elapsed / 325);
      const before = element.scrollLeft;
      element.scrollLeft += velocity * 325 * (1 - decay);
      velocity *= decay;
      if (
        Math.abs(velocity) < 0.015 ||
        Math.abs(element.scrollLeft - before) < 0.1
      ) {
        stopMomentum();
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const down = (event: PointerEvent) => {
    cancel();
    suppressClick = false;
    if (
      event.button !== 0 ||
      event.pointerType !== "mouse" ||
      element.scrollWidth <= element.clientWidth
    )
      return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      left: element.scrollLeft,
      moved: false,
      samples: [{ time: performance.now(), left: element.scrollLeft }],
    };
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) {
      cancel();
      return;
    }
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.x) < 6) return;
      drag.moved = true;
      suppressClick = true;
      element.setPointerCapture(event.pointerId);
      element.classList.add("is-dragging");
    }
    event.preventDefault();
    element.scrollLeft = drag.left + drag.x - event.clientX;
    const time = performance.now();
    drag.samples.push({ time, left: element.scrollLeft });
    while (drag.samples.length > 2 && drag.samples[1].time < time - 100)
      drag.samples.shift();
  };
  const up = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const ended = drag;
    drag = null;
    element.classList.remove("is-dragging");
    if (element.hasPointerCapture(event.pointerId))
      element.releasePointerCapture(event.pointerId);
    if (!ended.moved) return;
    const first = ended.samples[0],
      last = ended.samples.at(-1)!;
    if (performance.now() - last.time > 80 || last.time <= first.time) return;
    coast(
      Math.max(
        -3,
        Math.min(3, (last.left - first.left) / (last.time - first.time)),
      ),
    );
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick || !event.detail) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const preventNativeDrag = (event: DragEvent) => event.preventDefault();
  const lostCapture = () => {
    if (drag) cancel();
  };
  const wheel = (event: WheelEvent) => {
    cancel();
    if (event.ctrlKey || element.scrollWidth <= element.clientWidth) return;
    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    element.scrollLeft +=
      delta *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element.clientWidth
          : 1);
  };
  element.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("lostpointercapture", lostCapture);
  element.addEventListener("click", click, true);
  element.addEventListener("dragstart", preventNativeDrag);
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("contextmenu", cancel);
  window.addEventListener("keydown", cancel);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", cancel);
  motion.addEventListener("change", cancel);
  return () => {
    cancel();
    element.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("lostpointercapture", lostCapture);
    element.removeEventListener("click", click, true);
    element.removeEventListener("dragstart", preventNativeDrag);
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("contextmenu", cancel);
    window.removeEventListener("keydown", cancel);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", cancel);
    motion.removeEventListener("change", cancel);
  };
}
