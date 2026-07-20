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
import { IconCheck, IconClipboard, IconGauge, IconKey, IconLoader2, IconMail, IconBrandSlack } from "@tabler/icons-react";
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

function buildSlackMessage(email: string) {
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/outreach`
    : "https://builder-li.netlify.app/outreach";
  return `Hey! I've added you to our Builder.LI workspace. Sign in at ${url} with your Google account (${email}) to accept your invitation.`;
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500",
  "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-indigo-500",
];

function avatarColor(email: string) {
  let h = 0;
  for (const c of email) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function initials(email: string) {
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function OrgMembersSection() {
  const { data: orgInfo } = useOrg();
  const { data: membersData, isLoading: membersLoading } = useOrgMembers();
  const { data: invitesData } = useOrgInvitations();
  const { canManageOrg, canInviteMembers } = useOrgRole();
  const removeMember = useRemoveMember();
  const inviteMember = useInviteMember();

  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [lastInvitedEmail, setLastInvitedEmail] = useState("");
  const [slackCopied, setSlackCopied] = useState(false);

  if (!orgInfo?.orgId) {
    return <TeamPage showTitle={false} />;
  }

  const members = membersData?.members ?? [];
  const invitations = invitesData?.invitations ?? [];

  function handleCopySlack(email: string, mapKey?: string) {
    const key = mapKey ?? email;
    navigator.clipboard.writeText(buildSlackMessage(email)).then(() => {
      setCopiedMap((m) => ({ ...m, [key]: true }));
      setTimeout(() => setCopiedMap((m) => ({ ...m, [key]: false })), 2500);
    });
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    await inviteMember.mutateAsync({ email, role: inviteRole });
    setInviteEmail("");
    setLastInvitedEmail(email);
    setSlackCopied(false);
  }

  function handleCopyInviteMessage() {
    navigator.clipboard.writeText(buildSlackMessage(lastInvitedEmail)).then(() => {
      setSlackCopied(true);
      setTimeout(() => setSlackCopied(false), 2500);
    });
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Invite form */}
        {canInviteMembers && (
          <div className="px-5 py-4 border-b border-border">
            <form onSubmit={handleInvite} className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Invite by email address…"
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
                className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {inviteMember.isPending ? <IconLoader2 size={14} className="animate-spin" /> : null}
                Send invite
              </button>
            </form>
            {inviteMember.isError && (
              <p className="mt-2 text-xs text-destructive">
                {(inviteMember.error as Error)?.message ?? "Failed to invite"}
              </p>
            )}
            {lastInvitedEmail && (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/50 border border-border px-3 py-2.5">
                <IconBrandSlack size={15} className="shrink-0 text-muted-foreground" />
                <p className="flex-1 text-xs text-muted-foreground truncate">
                  Paste this in Slack → <span className="text-foreground">"{buildSlackMessage(lastInvitedEmail)}"</span>
                </p>
                <button
                  type="button"
                  onClick={handleCopyInviteMessage}
                  className="shrink-0 inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                >
                  {slackCopied ? <IconCheck size={12} className="text-emerald-600" /> : <IconClipboard size={12} />}
                  {slackCopied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Member list */}
        {membersLoading ? (
          <div className="flex items-center gap-2 px-5 py-4 text-sm text-muted-foreground">
            <IconLoader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : (
          <ul>
            {members.map((m) => (
              <li key={m.email} className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-b-0 group">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 ${avatarColor(m.email)}`}>
                  {initials(m.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{m.email}</p>
                </div>
                <div className="relative shrink-0">
                  <span className="text-xs text-muted-foreground capitalize group-hover:opacity-0 transition-opacity">
                    {m.role}
                  </span>
                  {canManageOrg && m.role !== "owner" && m.email !== orgInfo.email && (
                    <button
                      type="button"
                      onClick={() => removeMember.mutate(m.email)}
                      disabled={removeMember.isPending}
                      className="absolute inset-0 text-xs text-destructive opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-border last:border-b-0 group">
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-muted shrink-0">
                  <IconMail size={14} className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">Pending invitation · <span className="capitalize">{inv.role}</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopySlack(inv.email)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {copiedMap[inv.email] ? (
                    <IconCheck size={11} className="text-emerald-600" />
                  ) : (
                    <IconBrandSlack size={11} />
                  )}
                  {copiedMap[inv.email] ? "Copied!" : "Copy invite"}
                </button>
              </li>
            ))}
            {members.length === 0 && invitations.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                No members yet.
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
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
