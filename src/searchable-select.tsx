import { tr } from "./i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function SearchableSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string; search?: string }[];
  onChange: (value: string) => void;
  label: string;
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
    (option) =>
      query === null ||
      `${option.label} ${option.search || ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
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
  const choose = (option: (typeof options)[number]) => {
    onChange(option.value);
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
        value={
          open && query !== null
            ? query
            : options.find((option) => option.value === value)?.label || ""
        }
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
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onChange={(e) => {
          setQuery(e.target.value);

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
          } else if (
            e.key === "Enter" &&
            open &&
            matches[active < 0 ? 0 : active]
          ) {
            e.preventDefault();
            choose(matches[active < 0 ? 0 : active]);
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
            aria-label={tr("{0}选项", label)}
            className="lora-picker-options"
            style={rect}
          >
            {matches.length ? (
              matches.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  id={`${id}-${index}`}
                  data-index={index}
                  aria-selected={option.value === value}
                  data-active={index === active}
                  data-value={option.value}
                  tabIndex={-1}
                  title={option.search || option.label}
                  onPointerDown={(e) => e.preventDefault()}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <p role="status">{tr("没有匹配的选项")}</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
