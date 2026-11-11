import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { installBridge } from "./bridge_extension.js";
import { installModelControls } from "./model_controls.js";

const outputTypes = new Set();
app.registerExtension({
  name: "PromptEditor.GenerationBridge",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.output_node) outputTypes.add(nodeData.name);
  },
  setup() {
    const bridge = installBridge(app, api, outputTypes);
    if (bridge) {
      const heartbeat = () => { void bridge.publishCatalog(); void bridge.publishPresence().catch(error => console.warn("[Prompt Editor] 心跳失败", error)); };
      heartbeat(); setInterval(heartbeat, 5000);
    }
    const models = installModelControls(app, api);
    if (models) { models.publishModelCatalog(); setInterval(() => models.publishModelCatalog(), 2500); }
  },
});
