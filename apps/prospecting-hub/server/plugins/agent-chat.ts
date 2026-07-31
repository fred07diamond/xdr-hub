import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@xdr-hub/shared/server";
import actionsRegistry from "../../.generated/actions-registry.js";

const createWorkspaceAgentChatPlugin = (workspaceServer as Record<string, unknown>).createWorkspaceAgentChatPlugin;
const options = {
  appId: "prospecting-hub",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (createWorkspaceAgentChatPlugin as (options: AgentChatPluginOptions) => unknown)(options)
  : createAgentChatPlugin(options);
