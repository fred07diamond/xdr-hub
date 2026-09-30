import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@xdr-hub/shared/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const createWorkspaceAgentChatPlugin = (
  workspaceServer as Record<string, unknown>
).createWorkspaceAgentChatPlugin;
const options = {
  appId: "pa",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  // No raw SQL tool: app actions are the only data path, so form text reaches
  // the agent only as quoted data (framework docs: actions-agent-tools; D30).
  frameworkTools: { database: "off" },
  initialToolNames: [
    "view-screen",
    "navigate",
    "list-inbound",
    "get-engagement",
  ],
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (
      createWorkspaceAgentChatPlugin as (
        options: AgentChatPluginOptions,
      ) => unknown
    )(options)
  : createAgentChatPlugin(options);
