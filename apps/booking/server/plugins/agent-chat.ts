import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { INTRO_CALL_SYSTEM_PROMPT } from "../helpers/intro-call-system-prompt.js";

const INITIAL_TOOL_NAMES = ["view-screen", "navigate", "hello", "assess-intro-call-lead"];

export default createAgentChatPlugin({
  appId: "booking",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: INTRO_CALL_SYSTEM_PROMPT,
});
