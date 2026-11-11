// Background workflow pages must not be frozen while the editor is being used.
if (navigator.locks) {
  void navigator.locks.request("prompt-editor-live-workflow", () => new Promise(() => {})).catch(() => {});
}
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "w" && !event.isComposing) {
    event.preventDefault();
    event.stopImmediatePropagation();
    // Navigation is cancelled by the native host; no remote IPC access is granted.
    window.location.href = "prompt-editor-key://toggle-prompts";
  }
}, true);
