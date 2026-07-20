import {
  ChangelogSettingsCard,
  LanguagePicker,
  SettingsTabsPage,
  useActionMutation,
  useActionQuery,
  useAgentSettingsTabs,
  useT,
  type SettingsSearchEntry,
} from "@agent-native/core/client";
import {
  TeamPage,
  useOrg,
  useOrgInvitations,
  useOrgMembers,
  useOrgRole,
  useInviteMember,
  useRemoveMember,
} from "@agent-native/core/client/org";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconClipboard, IconGauge, IconKey, IconLoader2, IconMail } from "@tabler/icons-react";
import { useMemo, useState } from "react";

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
          Paste this token into the Builder.LI Chrome extension so your captures are linked to your account.
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
            <li>Install the Builder.LI Chrome extension.</li>
            <li>Click the extension icon → Options.</li>
            <li>Paste your app URL and this token, then save.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

function DailyLimitCard() {
  const { data } = useActionQuery("get-daily-stats", {});
  const stats = data as { capturedToday?: number; limit?: number | null } | undefined;
  const setLimit = useActionMutation("set-daily-limit");
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const val = parseInt(input, 10);
    if (!val || val < 1 || val > 500) return;
    await setLimit.mutateAsync({ limit: val });
    setInput("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card id="daily-limit" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconGauge size={16} />
          Daily Outreach Limit
        </CardTitle>
        <CardDescription>
          Set a workspace-wide soft cap on daily connection requests. Users see a warning meter in the extension. Admin only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats?.limit != null && (
          <p className="text-sm text-muted-foreground">
            Current limit: <span className="font-semibold text-foreground">{stats.limit}</span> per day
            {stats.capturedToday != null && (
              <> · <span className={stats.capturedToday >= stats.limit ? "text-destructive font-semibold" : ""}>{stats.capturedToday} captured today</span></>
            )}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={500}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={stats?.limit != null ? `Current: ${stats.limit}` : "e.g. 20"}
            className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={setLimit.isPending || !input}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {setLimit.isPending ? <IconLoader2 size={13} className="animate-spin" /> : saved ? <IconCheck size={13} /> : null}
            {saved ? "Saved!" : "Save"}
          </button>
        </div>
        {setLimit.isError && (
          <p className="text-xs text-destructive">{(setLimit.error as Error)?.message ?? "Failed to save"}</p>
        )}
      </CardContent>
    </Card>
  );
}

function OrgMembersSection() {
  const { data: orgInfo } = useOrg();
  const { data: membersData, isLoading: membersLoading } = useOrgMembers();
  const { data: invitesData } = useOrgInvitations();
  const { canManageOrg, canInviteMembers } = useOrgRole();
  const removeMember = useRemoveMember();
  const inviteMember = useInviteMember();
  const resend = useActionMutation("resend-invite");

  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [invited, setInvited] = useState(false);

  if (!orgInfo?.orgId) {
    return <TeamPage showTitle={false} />;
  }

  const members = membersData?.members ?? [];
  const invitations = invitesData?.invitations ?? [];

  async function handleResend(email: string) {
    await resend.mutateAsync({ email });
    setSentMap((m) => ({ ...m, [email]: true }));
    setTimeout(() => setSentMap((m) => ({ ...m, [email]: false })), 3000);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    await inviteMember.mutateAsync({ email: inviteEmail.trim(), role: inviteRole });
    setInviteEmail("");
    setInvited(true);
    setTimeout(() => setInvited(false), 3000);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          {orgInfo.orgName && <CardDescription>{orgInfo.orgName}</CardDescription>}
        </CardHeader>
        <CardContent className="p-0">
          {membersLoading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <IconLoader2 size={14} className="animate-spin" />
              Loading…
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Email</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Role</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Joined</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.email} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                    <td className="px-4 py-3">{m.email}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block capitalize text-xs px-2 py-0.5 rounded border border-border">
                        {m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {canManageOrg && m.role !== "owner" && m.email !== orgInfo.email && (
                        <button
                          type="button"
                          onClick={() => removeMember.mutate(m.email)}
                          disabled={removeMember.isPending}
                          className="text-xs text-destructive hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                    <td className="px-4 py-3">{inv.email}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block capitalize text-xs px-2 py-0.5 rounded border border-border">
                        {inv.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block text-xs px-2 py-0.5 rounded border border-amber-300/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50">
                        Invited
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleResend(inv.email)}
                        disabled={resend.isPending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        {sentMap[inv.email] ? (
                          <IconCheck size={11} className="text-emerald-600" />
                        ) : (
                          <IconMail size={11} />
                        )}
                        {sentMap[inv.email] ? "Sent!" : "Resend"}
                      </button>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && invitations.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No members yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canInviteMembers && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite a teammate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@example.com"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                className="rounded-md border border-border bg-background px-2 py-2 text-sm focus:outline-none"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="submit"
                disabled={inviteMember.isPending || !inviteEmail.trim()}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {inviteMember.isPending ? (
                  <IconLoader2 size={12} className="animate-spin" />
                ) : invited ? (
                  <IconCheck size={12} />
                ) : (
                  <IconMail size={12} />
                )}
                {invited ? "Invited!" : "Invite"}
              </button>
            </form>
            {inviteMember.isError && (
              <p className="mt-2 text-xs text-destructive">
                {(inviteMember.error as Error)?.message ?? "Failed to invite"}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function meta() {
  return [{ title: `Settings - ${APP_TITLE}` }];
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

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

  const enhancedTabs = useMemo(
    () =>
      agentSettingsTabs.map((tab) =>
        tab.id === "organization"
          ? {
              ...tab,
              content: (
                <div className="mx-auto w-full max-w-2xl">
                  <OrgMembersSection />
                </div>
              ),
            }
          : tab,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentSettingsTabs],
  );

  return (
    <SettingsTabsPage
      teamLabel={t("navigation.team")}
      extraTabs={enhancedTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <ApiTokenCard />

          <DailyLimitCard />

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
        <div className="mx-auto w-full max-w-2xl">
          <OrgMembersSection />
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
