"""Read live prompts from the portable Prompt Editor. No third-party dependencies."""

from .nodes import PromptEditorPrompts, PromptEditorGroupSwitch

NODE_CLASS_MAPPINGS = {"PromptEditorPrompts": PromptEditorPrompts, "PromptEditorGroupSwitch": PromptEditorGroupSwitch}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptEditorPrompts": "提示词编辑器 · 提示词与参数 (Prompt Editor)", "PromptEditorGroupSwitch": "提示词编辑器 · 分组开关"}
WEB_DIRECTORY = "./web"

try:
    from .routes import register_routes
    register_routes()
    from .model_routes import register_model_routes
    register_model_routes()
    from .link_routes import register_link_routes
    register_link_routes()
except ImportError as exc:
    # Standalone checker/tests intentionally run outside ComfyUI.
    if exc.name not in ("server", "aiohttp"):
        raise

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
