// Export workspace-wide server plugin overrides here when you need them.
// Chat-derived apps inherit these exports, so provide explicit framework defaults
// to keep generated workspaces warning-free until a workspace customizes them.
import {
  createAgentChatPlugin,
  defaultAuthPlugin,
  type AgentChatPluginOptions,
  type NitroPluginDef,
} from "@agent-native/core/server";

export function createWorkspaceAgentChatPlugin(
  options?: AgentChatPluginOptions,
): NitroPluginDef {
  return createAgentChatPlugin(options);
}

export const defaultAgentChatPlugin: NitroPluginDef =
  createWorkspaceAgentChatPlugin();
export { defaultAuthPlugin };
export const WORKSPACE_SHARED_NAME = "@xdr-hub/shared";

export { getSharedDb, workspaceUserRoles, workspaceAppAccess } from "./db/index.js";
export {
  getWorkspaceRole,
  isWorkspaceOwner,
  requireWorkspaceAdmin,
  type WorkspaceRole,
} from "./roles.js";
export { getWorkspaceOrgId, isWorkspaceMember } from "./workspace-org.js";
export { getHubSpotToken, hubspotFetch, hubspotFetchIfConnected } from "./hubspot-client.js";
