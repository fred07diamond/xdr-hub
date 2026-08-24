import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
  type AgentChatPluginOptions,
} from "@agent-native/core/server";
import * as workspaceServer from "@xdr-hub/shared/server";
import actionsRegistry from "../../.generated/actions-registry.js";

const createWorkspaceAgentChatPlugin = (workspaceServer as Record<string, unknown>).createWorkspaceAgentChatPlugin;
const options = {
  appId: "chat",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  // Allowlist for cross-app A2A calls (invokeAgentAction) -- without this,
  // filterDirectA2AActions returns nothing for ANY action regardless of its
  // own publicAgent config, and every invokeAgentAction call against this
  // app fails with "Unknown or unavailable read-only action". Named
  // explicitly here (rather than externalAgents.authenticatedReads: "auto")
  // so only actions we've deliberately reviewed for cross-app exposure are
  // reachable this way, not every readOnly+requiresAuth action in the app.
  connectorCatalog: ["list-unused-persona-leads", "generate-persona-search-link", "list-icp-personas-for-migration"],
} satisfies AgentChatPluginOptions;

export default typeof createWorkspaceAgentChatPlugin === "function"
  ? (createWorkspaceAgentChatPlugin as (options: AgentChatPluginOptions) => unknown)(options)
  : createAgentChatPlugin(options);
