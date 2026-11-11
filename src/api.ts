import { invoke, isTauri } from "@tauri-apps/api/core";
function normalize<T>(v: T): T {
  if (Array.isArray(v)) return v.map(normalize) as T;
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) {
      o[k] =
        k === "Values" && Array.isArray(x)
          ? Object.fromEntries(x.map((p) => [p.Key, p.Value]))
          : normalize(x);
    }
    return o;
  }
  return v;
}
let queue: Promise<unknown> = Promise.resolve();
export function rpc<T = any>(
  method: string,
  payload: unknown = {},
): Promise<T> {
  const call = async () => {
    if (isTauri()) return invoke<T>("rpc", { method, payload }).then(normalize);
    const response = await fetch("http://127.0.0.1:1421/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, payload }),
    });
    const result = await response.json();
    if (!response.ok || result.error) throw Error(result.error || "读取失败");
    return normalize(result.result) as T;
  };
  // Read-only generation status and image I/O run independently of editor writes.
  if (
    [
      "runs.poll",
      "runs.image",
      "runs.file",
      "runs.diagnostics",
      "runs.free",
      "runs.locate",
      "runs.feedback",
      "process.poll",
      "process.config",
      "process.test",
    ].includes(method)
  )
    return call();
  const next = queue.then(call, call);
  queue = next.catch(() => {});
  return next;
}
export async function pick(
  options: {
    directory?: boolean;
    multiple?: boolean;
    filters?: { name: string; extensions: string[] }[];
  } = {},
): Promise<string | string[] | null> {
  if (!isTauri()) throw Error("系统文件选择器请在 Tauri 桌面程序中使用");
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open(options);
}
export async function savePath(name: string, extensions = ["png"]) {
  if (!isTauri()) throw Error("系统文件选择器请在 Tauri 桌面程序中使用");
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({
    defaultPath: name,
    filters: [{ name: extensions.join(" / "), extensions }],
  });
}
export async function openExternal(url: string) {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  return openUrl(url);
}
export async function reveal(path: string) {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  return revealItemInDir(path);
}
export async function openFile(path: string) {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  return openPath(path);
}
export async function openDataFolder(path: string) {
  return reveal(`${path}/session.json`);
}
export async function imageUrl(path: string): Promise<string> {
  return rpc("image.url", { path });
}
export async function bytesBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
