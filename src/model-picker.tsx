import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ModelPicker({
  value,
  options,
  onChange,
  label = "搜索或选择 LoRA",
  listLabel = "可选 LoRA",
  modelType = "LoRA",
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label?: string;
  listLabel?: string;
  modelType?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState<string | null>(null);
  const [rect, setRect] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 0,
    transform: "",
  });
  const matches = options.filter(
    (name) =>
      query === null || name.toLowerCase().includes(query.toLowerCase()),
  );
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const r = input.current!.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 180 && above > below;
      const height = Math.min(300, Math.max(0, up ? above : below));
      setRect({
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        top: up ? r.top - 4 : r.bottom + 4,
        transform: up ? "translateY(-100%)" : "",
        width: Math.min(r.width, window.innerWidth - 16),
        maxHeight: height,
      });
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(input.current!);
    window.addEventListener("resize", position);
    const scroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) position();
    };
    window.addEventListener("scroll", scroll, true);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const choose = (name: string) => {
    onChange(name);
    setQuery(null);
    setOpen(false);
    setActive(-1);
  };
  return (
    <>
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        placeholder={`${label}…`}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && active >= 0 && active < matches.length
            ? `${id}-${active}`
            : undefined
        }
        value={value}
        onFocus={() => {
          setActive(-1);
          setQuery(null);
          setOpen(true);
        }}
        onClick={() => {
          if (!open) {
            setQuery(null);
            setActive(-1);
          }
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((n) =>
              matches.length
                ? e.key === "ArrowDown"
                  ? Math.min(n + 1, matches.length - 1)
                  : n < 0
                    ? matches.length - 1
                    : Math.max(0, n - 1)
                : -1,
            );
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          }
        }}
      />
      {open &&
        rect.width > 0 &&
        createPortal(
          <div
            ref={list}
            id={id}
            role="listbox"
            aria-label={listLabel}
            className="lora-picker-options"
            style={rect}
          >
            {matches.length ? (
              matches.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  role="option"
                  id={`${id}-${index}`}
                  data-index={index}
                  aria-selected={index === active}
                  tabIndex={-1}
                  title={name}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(name)}
                >
                  {name}
                </button>
              ))
            ) : (
              <p role="status">
                {options.length
                  ? `没有匹配的 ${modelType}`
                  : "请先读取节点与模型"}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
