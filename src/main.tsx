import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./comfy-link.css";
import "./comfy-results.css";
import "./motion.css";

window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});
// Shift/Ctrl during pointer range selection must not turn on keyboard focus rings.
window.addEventListener("pointerdown", () => {
  document.documentElement.dataset.focusInput = "pointer";
}, true);
window.addEventListener("keydown", (e) => {
  if (!["Shift", "Control", "Alt", "Meta"].includes(e.key))
    document.documentElement.dataset.focusInput = "keyboard";
}, true);

createRoot(document.getElementById("root")!).render(<App />);
