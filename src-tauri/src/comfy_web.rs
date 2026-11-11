use tauri::{Emitter, Manager};

// Shared with the main view configuration: WebView2 requires matching arguments
// for webviews using the same data directory. Keep workflow heartbeats timely.
const BROWSER_ARGS: &str = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

#[tauri::command]
pub async fn create_comfy_webview(
    app: tauri::AppHandle,
    caller: tauri::Webview,
    label: String,
    url: String,
) -> Result<(), String> {
    if caller.label() != "main" || !label.starts_with("comfy-") {
        return Err("仅编辑器主界面可以创建 ComfyUI 网页".into());
    }
    let url: tauri::Url = url.parse().map_err(|_| "ComfyUI 网页地址无效")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() {
        return Err("ComfyUI 网页地址须为 HTTP 或 HTTPS".into());
    }
    let window = app.get_window("main").ok_or("编辑器窗口不可用")?;
    let handle = app.clone();
    let builder = tauri::webview::WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
        .disable_drag_drop_handler()
        .additional_browser_args(BROWSER_ARGS)
        .initialization_script(include_str!("comfy_web_init.js"))
        .on_navigation(move |url| {
            if url.scheme() == "prompt-editor-key" {
                if url.host_str() == Some("toggle-prompts") {
                    let _ = handle.emit_to("main", "prompt-editor-toggle-prompts", ());
                }
                false
            } else { true }
        });
    window.add_child(builder, tauri::LogicalPosition::new(-10000.0, -10000.0), tauri::LogicalSize::new(1.0, 1.0))
        .map_err(|e| e.to_string())?;
    Ok(())
}
