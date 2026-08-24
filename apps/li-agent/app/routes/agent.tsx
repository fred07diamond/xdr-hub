import * as AgentClient from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { useOrgRole } from "@agent-native/core/client/org";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { Navigate } from "react-router";

import { resolveAgentPageComponent } from "@/lib/agent-page";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  useSetPageTitle(t("settings.agentTitle"));

  if (!canManageOrg) return <Navigate to="/" replace />;

  const AgentPage = resolveAgentPageComponent(AgentClient);
  return <AgentPage appName={APP_TITLE} />;
}
