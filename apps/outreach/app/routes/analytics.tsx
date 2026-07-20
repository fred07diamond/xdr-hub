import { useActionQuery } from "@agent-native/core/client";
import { useOrgRole } from "@agent-native/core/client/org";
import { IconChartBar, IconLoader2, IconMessageReport, IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
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
  const { data: feedbackData } = useActionQuery("list-feedback", {});

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

      {/* User Feedback */}
      <FeedbackSection feedbackData={feedbackData} />
    </div>
  );
}

type FeedbackItem = { id: string; userEmail: string | null; sentiment: string | null; message: string; createdAt: string | null };

function FeedbackSection({ feedbackData }: { feedbackData: unknown }) {
  const items = (feedbackData as { feedback?: FeedbackItem[] } | undefined)?.feedback;
  if (!items) return null;

  const positiveCount = items.filter((i) => i.sentiment === "positive").length;
  const negativeCount = items.filter((i) => i.sentiment === "negative").length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">User Feedback</h2>
        {items.length > 0 && (
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
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <IconMessageReport className="size-7 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => (
            <div key={item.id} className="flex gap-3 px-4 py-3">
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
                  <span className="shrink-0 text-xs text-muted-foreground/60">
                    {formatDate(item.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
              </div>
            </div>
          ))}
        </div>
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
