import { ChangelogSettingsCard } from "@agent-native/core/client/changelog";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { oauthRedirectUri } from "@agent-native/core/client/host";
import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import { TeamPage } from "@agent-native/core/client/org";
import {
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useActionMutation } from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCircleCheck, IconCircleX, IconExternalLink } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { APP_TITLE } from "@/lib/app-config";

import changelog from "../../CHANGELOG.md?raw";

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

type GoogleStatus = {
  connected: boolean;
  accounts: { email: string }[];
};

function useGoogleStatus() {
  return useQuery<GoogleStatus>({
    queryKey: ["google-calendar-status"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/google/status"),
        { credentials: "include" },
      );
      if (!res.ok) return { connected: false, accounts: [] };
      return res.json() as Promise<GoogleStatus>;
    },
    staleTime: 15_000,
  });
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));
  const queryClient = useQueryClient();
  const googleStatus = useGoogleStatus();
  const [wantUrl, setWantUrl] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disconnect = useActionMutation("disconnect-google-calendar") as any;
  const authUrl = useQuery<{ url: string }>({
    queryKey: ["google-add-account-url"],
    queryFn: async () => {
      const redirectUri = oauthRedirectUri(
        "/_agent-native/google/add-account/callback",
      );
      const res = await fetch(
        agentNativePath(
          `/_agent-native/google/add-account/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body.error as string) || "Failed to get auth URL");
      }
      return res.json() as Promise<{ url: string }>;
    },
    enabled: wantUrl,
    retry: false,
  });

  useEffect(() => {
    if (!wantUrl || !authUrl.data?.url) return;
    setWantUrl(false);
    const popup = window.open(authUrl.data.url, "_blank");
    toast("Complete the Google sign-in in the new tab — this page will update automatically.");
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        void queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      }
    }, 800);
  }, [wantUrl, authUrl.data, queryClient]);

  useEffect(() => {
    if (authUrl.error) {
      toast.error(
        authUrl.error instanceof Error
          ? authUrl.error.message
          : "Failed to connect Google Calendar",
      );
      setWantUrl(false);
    }
  }, [authUrl.error]);

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "chat-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
      extraTabs={agentSettingsTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <Card id="google-calendar" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">Google Calendar</CardTitle>
              <CardDescription>
                Connect your Google Calendar to view and sync events in the
                Meetings page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {googleStatus.data?.connected ? (
                    <>
                      <IconCircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium">Connected</p>
                        {(googleStatus.data.accounts?.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {googleStatus.data.accounts
                              .map((a) => a.email)
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <IconCircleX className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Not connected
                      </p>
                    </>
                  )}
                </div>
                {googleStatus.data?.connected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                      disconnect.mutate(
                        {},
                        {
                          onSuccess: () => {
                            void queryClient.invalidateQueries({
                              queryKey: ["google-calendar-status"],
                            });
                            toast.success("Google Calendar disconnected.");
                          },
                          onError: () => toast.error("Failed to disconnect."),
                        },
                      );
                    }}
                    disabled={disconnect.isPending}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setWantUrl(true)}
                    disabled={authUrl.isLoading || authUrl.isFetching}
                  >
                    <IconExternalLink className="me-1.5 h-3.5 w-3.5" />
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card id="language" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">
                {t("settings.languageTitle")}
              </CardTitle>
              <CardDescription>
                {t("settings.languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-w-xs space-y-1.5">
              <Label>{t("settings.languageLabel")}</Label>
              <LanguagePicker label={t("settings.languageLabel")} />
            </CardContent>
          </Card>
        </div>
      }
      team={
        <div className="mx-auto w-full max-w-3xl">
          <TeamPage
            showTitle={false}
            createOrgDescription={t("pages.teamCreateOrgDescription")}
          />
        </div>
      }
      whatsNew={
        <div className="mx-auto w-full max-w-2xl">
          <ChangelogSettingsCard markdown={changelog} />
        </div>
      }
    />
  );
}
