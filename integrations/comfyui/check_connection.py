"""Optional portable connection check, using the exact bundled node client."""
import importlib.util
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
source = root / "custom_nodes" / "ComfyUI-Prompt-Editor-Bridge" / "nodes.py"
if not source.exists():
    source = root / "ComfyUI-Prompt-Editor-Bridge" / "nodes.py"
spec = importlib.util.spec_from_file_location("prompt_editor_connection_check", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    state = module.fetch_snapshot(sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8189", 10, 2)
except RuntimeError as exc:
    print(str(exc))
    sys.exit(1)
print("Connected. positive: {} chars; negative: {} chars".format(len(state["positive"]), len(state["negative"])))
g = state["generation"]
print("seed={seed}, steps={steps}, cfg={cfg}, sampler={sampler}, size={width}x{height}, batch={batch_size}, control={seed_control}".format(**g))
print("Group switches: {}".format(len(g["groups"])))
