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
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCheck, IconCircleCheck, IconCircleX, IconClipboard, IconExternalLink, IconKey, IconLoader2 } from "@tabler/icons-react";
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

type ZoomStatus = {
  connected: boolean;
  accounts: { email: string }[];
  configured: boolean;
};

function useZoomStatus() {
  return useQuery<ZoomStatus>({
    queryKey: ["zoom-status"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/zoom/status"), {
        credentials: "include",
      });
      if (!res.ok) return { connected: false, accounts: [], configured: false };
      return res.json() as Promise<ZoomStatus>;
    },
    staleTime: 15_000,
  });
}

function useNooksStatus() {
  return useQuery<ZoomStatus>({
    queryKey: ["nooks-status"],
    queryFn: async () => {
      const res = await fetch(agentNativePath("/_agent-native/nooks/status"), {
        credentials: "include",
      });
      if (!res.ok) return { connected: false, accounts: [], configured: false };
      return res.json() as Promise<ZoomStatus>;
    },
    staleTime: 15_000,
  });
}

function ApiTokenCard() {
  const { data, isLoading } = useActionQuery("get-api-token", {});
  const token = (data as any)?.token as string | undefined;
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card id="api-token" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconKey size={16} />
          Personal API Token
        </CardTitle>
        <CardDescription>
          Paste this token into the Nooks Capture browser extension so your captured call transcripts are linked to your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : token ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
              {token}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
            >
              {copied ? <IconCheck size={13} /> : <IconClipboard size={13} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Failed to load token.</p>
        )}
        <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">Extension setup</p>
          <ol className="list-decimal ps-4 space-y-0.5">
            <li>Load the Nooks Capture extension (chrome://extensions → Load unpacked).</li>
            <li>Click the extension icon → Options.</li>
            <li>Paste this token, then save.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
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

  const zoomStatus = useZoomStatus();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disconnectZoom = useActionMutation("disconnect-zoom") as any;
  const [wantZoomUrl, setWantZoomUrl] = useState(false);
  const zoomAuthUrl = useQuery<{ url: string }>({
    queryKey: ["zoom-auth-url"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/zoom/auth-url"),
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((body.error as string) || "Failed to get Zoom auth URL");
      }
      return res.json() as Promise<{ url: string }>;
    },
    enabled: wantZoomUrl,
    retry: false,
  });

  useEffect(() => {
    if (!wantZoomUrl || !zoomAuthUrl.data?.url) return;
    setWantZoomUrl(false);
    const popup = window.open(zoomAuthUrl.data.url, "_blank");
    toast("Complete the Zoom sign-in in the new tab — this page will update automatically.");
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        void queryClient.invalidateQueries({ queryKey: ["zoom-status"] });
      }
    }, 800);
  }, [wantZoomUrl, zoomAuthUrl.data, queryClient]);

  useEffect(() => {
    if (zoomAuthUrl.error) {
      toast.error(
        zoomAuthUrl.error instanceof Error
          ? zoomAuthUrl.error.message
          : "Failed to connect Zoom",
      );
      setWantZoomUrl(false);
    }
  }, [zoomAuthUrl.error]);

  const nooksStatus = useNooksStatus();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disconnectNooks = useActionMutation("disconnect-nooks") as any;
  const [wantNooksUrl, setWantNooksUrl] = useState(false);
  const nooksAuthUrl = useQuery<{ url: string }>({
    queryKey: ["nooks-auth-url"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/nooks/auth-url"),
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error((body.error as string) || "Failed to get Nooks auth URL");
      }
      return res.json() as Promise<{ url: string }>;
    },
    enabled: wantNooksUrl,
    retry: false,
  });

  useEffect(() => {
    if (!wantNooksUrl || !nooksAuthUrl.data?.url) return;
    setWantNooksUrl(false);
    const popup = window.open(nooksAuthUrl.data.url, "_blank");
    toast("Complete the Nooks sign-in in the new tab — this page will update automatically.");
    const timer = setInterval(() => {
      if (popup?.closed) {
        clearInterval(timer);
        void queryClient.invalidateQueries({ queryKey: ["nooks-status"] });
      }
    }, 800);
  }, [wantNooksUrl, nooksAuthUrl.data, queryClient]);

  useEffect(() => {
    if (nooksAuthUrl.error) {
      toast.error(
        nooksAuthUrl.error instanceof Error
          ? nooksAuthUrl.error.message
          : "Failed to connect Nooks",
      );
      setWantNooksUrl(false);
    }
  }, [nooksAuthUrl.error]);

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

          <ApiTokenCard />

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

          <Card id="zoom" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">Zoom</CardTitle>
              <CardDescription>
                Connect your Zoom account so booked meetings can generate a
                unique Zoom link automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {zoomStatus.data?.connected ? (
                    <>
                      <IconCircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium">Connected</p>
                        {(zoomStatus.data.accounts?.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {zoomStatus.data.accounts.map((a) => a.email).join(", ")}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <IconCircleX className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {zoomStatus.data && !zoomStatus.data.configured
                          ? "Not configured — a workspace admin must set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET."
                          : "Not connected"}
                      </p>
                    </>
                  )}
                </div>
                {zoomStatus.data?.connected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                      disconnectZoom.mutate(
                        {},
                        {
                          onSuccess: () => {
                            void queryClient.invalidateQueries({ queryKey: ["zoom-status"] });
                            toast.success("Zoom disconnected.");
                          },
                          onError: () => toast.error("Failed to disconnect."),
                        },
                      );
                    }}
                    disabled={disconnectZoom.isPending}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setWantZoomUrl(true)}
                    disabled={
                      zoomAuthUrl.isLoading ||
                      zoomAuthUrl.isFetching ||
                      zoomStatus.data?.configured === false
                    }
                  >
                    <IconExternalLink className="me-1.5 h-3.5 w-3.5" />
                    Connect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card id="nooks" className="scroll-mt-16">
            <CardHeader>
              <CardTitle className="text-base">Nooks</CardTitle>
              <CardDescription>
                Connect your Nooks account so your booked-meeting calls can
                flow into the workflow automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {nooksStatus.data?.connected ? (
                    <>
                      <IconCircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-sm font-medium">Connected</p>
                        {(nooksStatus.data.accounts?.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {nooksStatus.data.accounts.map((a) => a.email).join(", ")}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <IconCircleX className="h-5 w-5 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {nooksStatus.data && !nooksStatus.data.configured
                          ? "Not configured — a workspace admin must set NOOKS_CLIENT_ID and NOOKS_CLIENT_SECRET."
                          : "Not connected"}
                      </p>
                    </>
                  )}
                </div>
                {nooksStatus.data?.connected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                      disconnectNooks.mutate(
                        {},
                        {
                          onSuccess: () => {
                            void queryClient.invalidateQueries({ queryKey: ["nooks-status"] });
                            toast.success("Nooks disconnected.");
                          },
                          onError: () => toast.error("Failed to disconnect."),
                        },
                      );
                    }}
                    disabled={disconnectNooks.isPending}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setWantNooksUrl(true)}
                    disabled={
                      nooksAuthUrl.isLoading ||
                      nooksAuthUrl.isFetching ||
                      nooksStatus.data?.configured === false
                    }
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
