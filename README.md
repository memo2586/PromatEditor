# Prompt Editor · 提示词编辑器

Windows 桌面提示词编辑与 ComfyUI 协同工具，基于 Tauri 2、Rust、React 和 TypeScript。支持深色 / 浅色主题，使用便携数据目录。

## 下载与运行

在 [GitHub Releases](https://github.com/memo2586/PromatEditor/releases/latest) 下载 Windows x64 的 `PromptEditor.exe`，放到可写目录后运行。需要 Windows 10 / 11 x64 和 Microsoft Edge WebView2 Runtime；使用编译好的程序不需要安装 Node.js、Rust 或 Python。

程序默认在可执行文件同级的 `data/` 中保存设置、工作区和资源资料。升级前请备份并保留整个 `data/`。也可通过 `--data-dir <目录>` 指定位置。旧版 JSON 项目和 PNG 提示词卡可继续导入。

## 主要功能

- **提示词编辑**：积极 / 消极工作区，原文与结构化词条同步编辑；支持括号权重、视觉分组、自然语言组描述、隐藏、拖拽、批量操作、查词和光标补全。
- **资源管理**：内置提示词库、收藏与片段、多张参考图，以及 LoRA 模型资料、触发词和推荐权重。
- **生成与模型控制**：连接 ComfyUI，提交任务、查看队列与进度，设置 Seed、CFG、采样器、尺寸、工作流分组，以及 LoRA、UNet、VAE。
- **生成记录**：按项目、会话和状态筛选，输入搜索；项目与会话按最近记录排序。网格支持 Ctrl + 滚轮调整图像大小，胶片条只显示当前项目。
- **参数差异**：对比提示词、生成参数、工作流分组、模型及权重；支持大图查看、部分导入、完整应用、原参数重跑和随机 Seed 重跑。
- **项目与快照**：保存 PNG 提示词卡、创建命名快照，恢复提示词、分组及成员、参数和模型设置；支持撤销 / 重做。单纯的视觉组归属与组块顺序变化不计入差异。
- **ComfyUI 工作台**：独立控制台与网页标签页。启动本地 ComfyUI 前，在设置中指定实际安装目录、Python 和所需附加参数。

胶片条中点击图片查看大图，点击 Seed 复制数值，点击积极提示词差异复制该图的完整积极提示词，点击其他差异打开导入选择器。右键差异区可以重新生成、保存快照后应用、确认后直接应用或删除记录；重新生成不会覆盖当前项目，删除记录不会删除原图。

## 推荐工作流

推荐使用这位作者维护的 [Anima Workflows](https://civitai.com/models/2426853/anima-workflows)，可与本工具配合使用。

请按作者页面说明获取工作流、模型和依赖，加载后再安装下方 Bridge，并在编辑器中读取、选择对应的模型节点和工作流分组。

## 连接 ComfyUI

1. 把 [`integrations/comfyui/ComfyUI-Prompt-Editor-Bridge`](integrations/comfyui/ComfyUI-Prompt-Editor-Bridge) 整个目录放进 ComfyUI 的 `custom_nodes/`。
2. 重启 ComfyUI，刷新浏览器并打开工作流，添加「提示词编辑器 · 提示词与参数」节点。
3. 启动编辑器，配置实际 ComfyUI 地址。ComfyUI 常用端口为 `8188`，编辑器本地 Bridge 默认端口为 `8189`。
4. 读取节点、模型和分组，选择控制目标后生成。更新时请整体替换 Bridge 目录，并同步更新编辑器。

生成联动需要 ComfyUI 服务和打开对应工作流的浏览器页面；提示词编辑、资源管理与项目保存可以独立使用。扩展细节见 [Bridge 使用说明](integrations/comfyui/ComfyUI-Prompt-Editor-Bridge/README.md)。

## 从源码构建

需要 Windows x64、Node.js、Rust、MSVC C++ 构建工具、Windows SDK 和 WebView2。

```powershell
git clone https://github.com/memo2586/PromatEditor.git
cd PromatEditor
npm ci
npm run tauri -- build --no-bundle
```

可执行文件位于 `src-tauri/target/release/prompt-editor-tauri.exe`。将其复制到自己的便携目录，可改名为 `PromptEditor.exe`。运行程序会创建数据目录。

开发模式：

```powershell
npm run tauri -- dev
```

开发前端使用 `1420` 端口，开发 RPC 使用 `1421`；发行版内嵌前端，不依赖开发服务器。

## 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| Ctrl+Enter | 提交生成 |
| Ctrl+↑ / Ctrl+↓ | 调整词条权重 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |
| Ctrl+S / Ctrl+Shift+S | 保存 / 另存为提示词卡 |
| Ctrl+Shift+C | 复制当前工作区有效提示词 |
| Ctrl+J | 折叠 / 展开胶片条 |
| Ctrl+滚轮 | 在生成记录网格中调整图像大小 |
| Tab / Esc | 接受 / 关闭原文补全 |
| F5 | 刷新外部统计词库 |

## 启动参数

| 参数 | 说明 |
| --- | --- |
| `--data-dir <目录>` / `--data <目录>` | 指定数据目录 |
| `--bridge-port <端口>` | 设置本地 Bridge 端口，默认 8189 |

## 源码结构

- `src/`：React 界面与交互。
- `src-tauri/`：Rust 应用、存储、解析、内置词库和运行资源。
- `public/`：图标与字体。
- `integrations/comfyui/`：ComfyUI 节点与浏览器扩展、连接检查和示例工作流。

本公开仓库只保留产品源码、构建配置、必要资源和使用说明，不包含设计稿、截图、开发验收记录或测试工程。

## 许可证

代码使用 [MIT License](LICENSE)。字体的 OFL 许可证随文件保存在 [`public/fonts/`](public/fonts/)。
