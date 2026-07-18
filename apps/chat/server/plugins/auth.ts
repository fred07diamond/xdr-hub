import { defaultAuthPlugin as frameworkDefault } from "@agent-native/core/server";
import * as workspaceServer from "@builder-li/shared/server";

const workspacePlugin = (workspaceServer as Record<string, unknown>).defaultAuthPlugin;

export default typeof workspacePlugin === "function"
  ? workspacePlugin
  : frameworkDefault;
