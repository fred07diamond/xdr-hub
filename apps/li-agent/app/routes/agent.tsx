import * as AgentClient from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { Navigate } from "react-router";

import { resolveAgentPageComponent } from "@/lib/agent-page";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Agent - ${APP_TITLE}` }];
}

export default function AgentRoute() {
  const t = useT();
  const { data: roleData, isLoading: isRoleLoading } = useActionQuery("get-my-role", {});
  const isWorkspaceAdmin = (roleData as { role?: string } | undefined)?.role === "admin";
  useSetPageTitle(t("settings.agentTitle"));

  if (isRoleLoading) return null;
  if (!isWorkspaceAdmin) return <Navigate to="/" replace />;

  const AgentPage = resolveAgentPageComponent(AgentClient);
  return <AgentPage appName={APP_TITLE} />;
}
