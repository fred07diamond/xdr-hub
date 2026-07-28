import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useDbSync } from "@agent-native/core/client/hooks";
import {
  AppProviders,
  createAgentNativeQueryClient,
} from "@agent-native/core/client/hooks";
import { getLocaleInitScript, useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client/navigation";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import { useOrg, useAcceptInvitation } from "@agent-native/core/client/org";
import {
  IconHierarchy2,
  IconSun,
  IconMoon,
  IconLoader2,
  IconUserPlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { APP_TITLE } from "@/lib/app-config";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "booking",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#18181B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDbSync({
    queryClient: qc,
    ignoreSource: TAB_ID,
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

/**
 * Blocks the app shell for users who have no workspace membership.
 * Unlike RequireActiveOrg, never shows the "Create organization" form —
 * only shows pending invitations and a contact-your-admin message.
 */
function InviteOnlyGate({ children }: { children: React.ReactNode }) {
  const { data: org, isLoading, isError, refetch } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (isLoading) return null;

  if (isError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
          <p className="mb-4 text-sm text-muted-foreground">
            Failed to load workspace info. Please try again.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (org?.orgId) return <>{children}</>;

  const pendingInvitations = org?.pendingInvitations ?? [];

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-lg font-semibold">XDR Booking Agent</h1>
        {pendingInvitations.length === 0 ? (
          <p className="mb-6 text-sm text-muted-foreground">
            This workspace is invite-only. Ask your admin (fred@builder.io) to invite you.
          </p>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            Accept your invitation below to get started.
          </p>
        )}
        {pendingInvitations.length > 0 && (
          <ul className="space-y-2">
            {pendingInvitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <IconUserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{inv.orgName}</div>
                  <div className="text-xs text-muted-foreground">Invited by {inv.invitedBy}</div>
                </div>
                <button
                  type="button"
                  disabled={acceptInvitation.isPending}
                  onClick={() => acceptInvitation.mutate(inv.id)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {acceptInvitation.isPending ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Accept"
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="chat"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          <CommandMenu.Item onSelect={() => {}}>
            {t("root.commandSearch")}
          </CommandMenu.Item>
          <CommandMenu.Item
            onSelect={() => navigate("/agent")}
            keywords={[
              "agent",
              "context",
              "files",
              "connections",
              "jobs",
              "access",
            ]}
          >
            <IconHierarchy2 size={16} />
            {t("settings.openAgentSettings")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <InviteOnlyGate>
        <AppLayout>
          <Outlet />
        </AppLayout>
      </InviteOnlyGate>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppToolkitProvider>
      <AppProviders queryClient={queryClient} i18n={{ catalog: i18nCatalog }}>
        <DbSyncSetup />
        <AppContent />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client/ui";
