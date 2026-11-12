import { tr } from "./i18n";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { ComfyNativeView } from "./comfy-native-view";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Browser,
  Gear,
} from "@phosphor-icons/react";
import { useApp } from "./context";
import { useComfyProcess, openComfySettings } from "./comfy-process";
import { openExternal } from "./api";
import { IconButton } from "./ui";

export function ComfyWebLauncher() {
  const app = useApp(),
    process = useComfyProcess();
  return (
    <button
      className={`nav-item ${app.page === "comfy" ? "selected" : ""}`}
      onClick={() =>
        void process.openWeb().catch((e) => app.reportError(String(e)))
      }
    >
      <Browser size={16} />
      <span>{tr("ComfyUI 网页")}</span>
    </button>
  );
}

export function ComfyWebPage() {
  const app = useApp(),
    process = useComfyProcess();
  const [revision, setRevision] = useState(0);
  const url = process.config?.webUrl?.trim() || app.data.bridge.comfyUrl;
  return (
    <div className="comfy-web-page">
      <header>
        <strong>ComfyUI</strong>
        <span title={url}>{url}</span>
        <IconButton
          icon={ArrowsClockwise}
          label={tr("重新加载 ComfyUI 网页")}
          onClick={() => setRevision((v) => v + 1)}
        />
        <IconButton
          icon={ArrowSquareOut}
          label={tr("在默认浏览器打开 ComfyUI")}
          onClick={() =>
            void openExternal(url).catch((e) => app.reportError(String(e)))
          }
        />
        <IconButton
          icon={Gear}
          label={tr("ComfyUI 网页设置")}
          onClick={() => openComfySettings(app)}
        />
      </header>
      {isTauri() ? (
        <ComfyNativeView
          key={`${url}/${revision}`}
          url={url}
          active={app.page === "comfy"}
        />
      ) : (
        <iframe
          key={`${url}/${revision}`}
          src={url}
          title={tr("ComfyUI 工作流网页")}
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      )}
      <p>{tr("页面无法显示时，请确认服务已启动，然后重新加载；也可在默认浏览器打开。")}</p>
    </div>
  );
}
