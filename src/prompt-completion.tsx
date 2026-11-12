import { tr } from "./i18n";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { rpc } from "./api";
import { caretPosition } from "./caret-position";
import type { Lexeme } from "./types";

type Completion = {
  items: Lexeme[];
  caret: number;
  start: number;
  end: number;
  index: number;
};

export function usePromptCompletion(
  inputRef: RefObject<HTMLTextAreaElement | null>,
  onChoose: (text: string, start: number, end: number) => void,
  modal = false,
) {
  const [completion, setCompletion] = useState<Completion | null>(null);
  const version = useRef(0);
  const popupRef = useRef<HTMLDivElement>(null);
  const close = () => {
    version.current++;
    setCompletion(null);
  };
  const search = async (input: HTMLTextAreaElement) => {
    const request = ++version.current;
    const text = input.value;
    const caret = input.selectionStart;
    const before = text.slice(0, caret);
    let start =
      Math.max(
        ...[",", "，", ";", "；", "\n"].map((s) => before.lastIndexOf(s)),
      ) + 1;
    while (start < caret && /[\s(]/.test(text[start])) start++;
    let end = caret;
    while (end < text.length && !/[,;，；\n)]/.test(text[end])) end++;
    const colon = text.slice(start, end).lastIndexOf(":");
    if (colon >= 0) end = start + colon;
    const query = text.slice(start, Math.min(caret, end)).trim();
    setCompletion(null);
    if (
      query.length < 2 ||
      query.startsWith("<") ||
      input.selectionEnd !== caret
    )
      return;
    try {
      const items = await rpc<Lexeme[]>("lexicon.search", { text: query });
      if (
        version.current === request &&
        items.length &&
        input.isConnected &&
        document.activeElement === input &&
        input.value === text &&
        input.selectionStart === caret &&
        input.selectionEnd === caret
      ) {
        setCompletion({
          items: items.slice(0, 12),
          caret,
          start,
          end,
          index: 0,
        });
      }
    } catch {
      if (version.current === request) setCompletion(null);
    }
  };
  useLayoutEffect(() => {
    const input = inputRef.current;
    const popup = popupRef.current;
    if (!completion || !input || !popup) return;
    const position = () => {
      const anchor = caretPosition(input, completion.caret);
      const rect = input.getBoundingClientRect();
      if (anchor.top + anchor.height < rect.top || anchor.top > rect.bottom) {
        close();
        return;
      }
      const height = popup.offsetHeight;
      const below = anchor.top + anchor.height + 4;
      const top =
        below + height <= innerHeight - 8 ? below : anchor.top - height - 4;
      popup.style.left =
        Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8)) +
        "px";
      popup.style.top =
        Math.max(8, Math.min(top, innerHeight - height - 8)) + "px";
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(input);
    observer.observe(popup);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [completion, inputRef]);
  const choose = (index: number) => {
    if (!completion) return;
    close();
    onChoose(completion.items[index].Text, completion.start, completion.end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      !completion ||
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (event.key === "Tab" && event.shiftKey) ||
      !["Tab", "Escape", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Tab") choose(completion.index);
    else if (event.key === "Escape") close();
    else {
      const index =
        (completion.index +
          completion.items.length +
          (event.key === "ArrowDown" ? 1 : -1)) %
        completion.items.length;
      setCompletion({ ...completion, index });
      popupRef.current
        ?.querySelectorAll('[role="option"]')
        [index]?.scrollIntoView({ block: "nearest" });
    }
  };
  const onSelect = (input: HTMLTextAreaElement) => {
    if (
      completion &&
      (input.selectionStart !== completion.caret ||
        input.selectionEnd !== completion.caret)
    )
      close();
  };
  const popup =
    completion &&
    createPortal(
      <div
        ref={popupRef}
        className={`completion ${modal ? "modal-completion" : ""}`}
        role="listbox"
        aria-label={tr("光标补全候选")}
        onMouseDown={(event) => event.preventDefault()}
      >
        {completion.items.map((item, index) => (
          <div
            role="option"
            aria-selected={index === completion.index}
            key={`${item.Source}-${item.Key}-${index}`}
            className={index === completion.index ? "active" : ""}
            onMouseEnter={() => setCompletion({ ...completion, index })}
            onDoubleClick={() => choose(index)}
          >
            <span className="mono">{item.Text}</span>
            <small>{item.Translation}</small>
            <small>
              {item.Source}
              {item.Count ? ` · ${item.Count.toLocaleString()}` : ""}
            </small>
          </div>
        ))}
        <p>{tr("Tab 补全 · 双击插入 · Esc 关闭")}</p>
      </div>,
      document.body,
    );
  return { open: !!completion, search, close, onKeyDown, onSelect, popup };
}
