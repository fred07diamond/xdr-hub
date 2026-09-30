import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { NotificationsBell } from "@agent-native/core/client/notifications";
import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import { IconMenu2 } from "@tabler/icons-react";
import { useLocation } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

const pageTitleKeys: Record<string, string> = {
  "/home": "navigation.chat",
  "/observability": "navigation.observability",
  "/agent": "settings.agentTitle",
  "/settings": "navigation.settings",
};

// PA pages are English-only for now; framework pages keep their i18n keys.
const PA_TITLES: Array<[string, string]> = [
  ["/playbook/changes", "Playbook change"],
  ["/playbook", "Playbook"],
  ["/suggestions", "Suggestions"],
  ["/handbook", "Sales handbook"],
  ["/crm", "CRM connections"],
  ["/inbound", "Inbound"],
  ["/labels", "Labels"],
  ["/ops", "Ops"],
];

function resolveTitle(pathname: string, t: (key: string) => string): string {
  if (pageTitleKeys[pathname]) return t(pageTitleKeys[pathname]);
  if (pathname.startsWith("/extensions")) return t("navigation.extensions");
  for (const [prefix, title] of PA_TITLES)
    if (pathname.startsWith(prefix)) return title;
  return APP_TITLE;
}

interface HeaderProps {
  onOpenMobileSidebar?: () => void;
}

export function Header({ onOpenMobileSidebar }: HeaderProps) {
  const location = useLocation();
  const t = useT();
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-background px-4 lg:px-6 shrink-0">
      {onOpenMobileSidebar && (
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-label={t("navigation.openNavigation")}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent md:hidden"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {title ?? (
          <h1 className="text-lg font-semibold tracking-tight truncate">
            {resolveTitle(location.pathname, t)}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <NotificationsBell
          emptyTitle="Nothing new"
          emptyDescription="Playbook suggestions and review requests show up here."
        />
        <AgentToggleButton />
      </div>
    </header>
  );
}
