import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { useOrgRole } from "@agent-native/core/client/org";
import { IconChartBar, IconCheck, IconLoader2, IconMessageReport, IconThumbDown, IconThumbUp, IconUsers } from "@tabler/icons-react";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useState } from "react";
import { Navigate } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_TITLE } from "@/lib/app-config";

function formatDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function meta() {
  return [{ title: `Analytics — ${APP_TITLE}` }];
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export default function AnalyticsRoute() {
  useSetPageTitle("Analytics");
  const { canManageOrg } = useOrgRole();
  if (!canManageOrg) return <Navigate to="/" replace />;
  const { data, isLoading, error } = useActionQuery("get-analytics", {});
  const { data: feedbackData, refetch: refetchFeedback } = useActionQuery("list-feedback", {});

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isAdmin = msg.toLowerCase().includes("admin") || msg.includes("403");
    return (
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <IconChartBar className="mx-auto mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? "Analytics is only available to workspace admins."
            : "Failed to load analytics."}
        </p>
      </div>
    );
  }

  const d = data as {
    totalProspects: number;
    verdictCounts: { strong: number; possible: number; weak: number };
    statusCounts: { captured: number; drafted: number; sent: number };
    thisWeek: number;
    lastWeek: number;
    totalUsers: number;
    totalSent: number;
    byUser: UserActivity[];
  };

  const sentRate = pct(d.totalSent, d.totalProspects);
  const weekDiff = d.thisWeek - d.lastWeek;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-wide pipeline overview.</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Prospects" value={d.totalProspects} />
        <StatCard label="Sent" value={d.totalSent} sub={`${sentRate} send rate`} />
        <StatCard
          label="This Week"
          value={d.thisWeek}
          sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
          subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
        />
        <StatCard label="Users" value={d.totalUsers} />
      </div>

      {/* Verdict breakdown */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Fit Verdict</h2>
        <div className="grid grid-cols-3 gap-3">
          <VerdictCard
            label="Strong"
            count={d.verdictCounts.strong}
            total={d.totalProspects}
            color="border-emerald-400/50 bg-emerald-500/5"
            textColor="text-emerald-600 dark:text-emerald-400"
          />
          <VerdictCard
            label="Possible"
            count={d.verdictCounts.possible}
            total={d.totalProspects}
            color="border-amber-400/50 bg-amber-500/5"
            textColor="text-amber-600 dark:text-amber-400"
          />
          <VerdictCard
            label="Weak"
            count={d.verdictCounts.weak}
            total={d.totalProspects}
            color="border-rose-400/50 bg-rose-500/5"
            textColor="text-rose-600 dark:text-rose-400"
          />
        </div>
      </div>

      {/* Status funnel */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Status Funnel</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <FunnelRow label="Captured" count={d.statusCounts.captured} total={d.totalProspects} />
          <FunnelRow label="Drafted" count={d.statusCounts.drafted} total={d.totalProspects} />
          <FunnelRow label="Sent" count={d.statusCounts.sent} total={d.totalProspects} />
        </CardContent>
      </Card>

      {/* Team Activity */}
      <TeamActivitySection byUser={d.byUser} />

      {/* User Feedback */}
      <FeedbackSection feedbackData={feedbackData} refetch={refetchFeedback} />
    </div>
  );
}

type FeedbackItem = { id: string; userEmail: string | null; sentiment: string | null; message: string; draftNote: string | null; createdAt: string | null; resolvedAt: string | null };

function FeedbackSection({ feedbackData, refetch }: { feedbackData: unknown; refetch: () => void }) {
  const [tab, setTab] = useState<"active" | "resolved">("active");
  const { mutate: resolve, isPending } = useActionMutation("resolve-feedback");

  const all = (feedbackData as { feedback?: FeedbackItem[] } | undefined)?.feedback ?? [];
  const active = all.filter((i) => !i.resolvedAt);
  const resolved = all.filter((i) => !!i.resolvedAt);
  const items = tab === "active" ? active : resolved;

  const positiveCount = active.filter((i) => i.sentiment === "positive").length;
  const negativeCount = active.filter((i) => i.sentiment === "negative").length;

  function handleResolve(id: string, isResolved: boolean) {
    resolve({ id, resolved: !isResolved }, { onSuccess: refetch });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">User Feedback</h2>
        {active.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-600">
              <IconThumbUp size={12} /> {positiveCount}
            </span>
            <span className="flex items-center gap-1 text-rose-500">
              <IconThumbDown size={12} /> {negativeCount}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-3 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        <button
          onClick={() => setTab("active")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            tab === "active"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Active
          {active.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {active.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("resolved")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            tab === "resolved"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Resolved
          {resolved.length > 0 && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {resolved.length}
            </span>
          )}
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <IconMessageReport className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {tab === "active" ? "No active feedback." : "No resolved feedback yet."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <div key={item.id} className={`flex gap-3 px-4 py-3 ${item.resolvedAt ? "opacity-60" : ""}`}>
              <div className="mt-0.5 shrink-0">
                {item.sentiment === "positive" ? (
                  <IconThumbUp size={14} className="text-emerald-500" />
                ) : item.sentiment === "negative" ? (
                  <IconThumbDown size={14} className="text-rose-500" />
                ) : (
                  <div className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-muted-foreground">
                    {item.userEmail ?? "Anonymous"}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground/60">{formatDate(item.createdAt)}</span>
                    <button
                      onClick={() => handleResolve(item.id, !!item.resolvedAt)}
                      disabled={isPending}
                      title={item.resolvedAt ? "Mark as active" : "Mark as resolved"}
                      className={`rounded p-0.5 transition-colors ${
                        item.resolvedAt
                          ? "text-muted-foreground/40 hover:text-foreground"
                          : "text-muted-foreground/40 hover:text-emerald-600"
                      }`}
                    >
                      <IconCheck size={14} />
                    </button>
                  </div>
                </div>
                {item.message && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
                )}
                {item.draftNote && (
                  <div className="mt-1.5 rounded bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Draft: </span>
                    {item.draftNote}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type UserActivity = {
  ownerEmail: string | null;
  total: number;
  drafted: number;
  sent: number;
  strong: number;
  possible: number;
  weak: number;
  inconclusive: number;
};

function TeamActivitySection({ byUser }: { byUser: UserActivity[] }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Team Activity</h2>
      {byUser.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <IconUsers className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No prospects added yet.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Teammate</th>
                  <th className="px-4 py-2 text-right font-medium">Added</th>
                  <th className="px-4 py-2 text-right font-medium">Drafted</th>
                  <th className="px-4 py-2 text-right font-medium">Sent</th>
                  <th className="px-4 py-2 text-right font-medium">Send Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Strong / Possible / Weak</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byUser.map((u) => (
                  <tr key={u.ownerEmail ?? "unassigned"}>
                    <td className="px-4 py-2.5 font-medium">{u.ownerEmail ?? "Unassigned"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.drafted.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{u.sent.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{pct(u.sent, u.total)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      <span className="text-emerald-600 dark:text-emerald-400">{u.strong}</span>
                      {" / "}
                      <span className="text-amber-600 dark:text-amber-400">{u.possible}</span>
                      {" / "}
                      <span className="text-rose-600 dark:text-rose-400">{u.weak}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, subColor }: { label: string; value: number; sub?: string; subColor?: string }) {
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        {sub && <p className={`mt-0.5 text-[11px] ${subColor ?? "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function VerdictCard({ label, count, total, color, textColor }: { label: string; count: number; total: number; color: string; textColor: string }) {
  return (
    <Card className={`border ${color}`}>
      <CardContent className="px-4 py-3">
        <p className={`text-xs font-medium ${textColor}`}>{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{count.toLocaleString()}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{pct(count, total)}</p>
      </CardContent>
    </Card>
  );
}

function FunnelRow({ label, count, total }: { label: string; count: number; total: number }) {
  const width = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-16 text-sm text-muted-foreground">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-muted h-2">
        <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${width}%` }} />
      </div>
      <span className="w-10 text-right text-sm font-medium tabular-nums">{count.toLocaleString()}</span>
      <span className="w-9 text-right text-xs text-muted-foreground">{pct(count, total)}</span>
    </div>
  );
}
