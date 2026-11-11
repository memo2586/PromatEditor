// Measure with the textarea's own typography and wrapping, in viewport coordinates.
export function caretPosition(input: HTMLTextAreaElement, caret: number) {
  const style = getComputedStyle(input);
  const mirror = document.createElement("div");
  for (const property of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textTransform", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const)
    mirror.style[property] = style[property];
  Object.assign(mirror.style, {
    position: "fixed", left: "0", top: "0", visibility: "hidden",
    boxSizing: "border-box", width: `${input.clientWidth}px`,
    whiteSpace: "pre-wrap", overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak, border: "0",
  });
  mirror.textContent = input.value.slice(0, caret);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(caret) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  try {
    const range = document.createRange();
    range.setStart(marker.firstChild!, 0);
    range.setEnd(marker.firstChild!, Math.min(1, marker.textContent.length));
    const mark = range.getBoundingClientRect();
    const rect = input.getBoundingClientRect();
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
    return {
      left: rect.left + input.clientLeft + mark.left - input.scrollLeft,
      top: rect.top + input.clientTop + marker.offsetTop - input.scrollTop,
      height: lineHeight,
    };
  } finally {
    mirror.remove();
  }
}
