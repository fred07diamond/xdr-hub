import { useActionMutation, useActionQuery, useSession } from "@agent-native/core/client/hooks";
import {
  IconCheck,
  IconChartBar,
  IconListCheck,
  IconLoader2,
  IconMessageReport,
  IconMessages,
  IconThumbDown,
  IconThumbUp,
  IconUsers,
} from "@tabler/icons-react";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_TITLE } from "@/lib/app-config";

// One accent color per pipeline -- used consistently for that pipeline's KPI
// accents, trend line, and leaderboard bars, so a reader can tell which
// section they're looking at without reading the heading.
const PIPELINE = {
  prospects: { label: "Prospects", color: "#6366f1" },
  engagers: { label: "Engagement", color: "#0ea5e9" },
  leads: { label: "Lead Lists", color: "#a855f7" },
} as const;

const VERDICT_COLOR = { strong: "#10b981", possible: "#f59e0b", weak: "#f43f5e" };
const AXIS_COLOR = "#9ca3af";

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

// No display-name column exists anywhere in this schema -- leaderboards only
// ever have an email to show. Formats the local-part into a readable name
// ("victoria@builder.io" -> "Victoria", "chris.smith@..." -> "Chris Smith")
// rather than showing the raw address, without adding a new lookup/dependency.
function emailToDisplayName(email: string): string {
  if (email === "Unassigned") return email;
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

type TrendPoint = { date: string; label: string; prospects: number; engagers: number; leads: number };

type PersonaAgg = { name: string; color: string | null; prospects: number; engagers: number; leads: number; total: number };

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

type PostEngagementData = {
  totalEngagers: number;
  distinctPosts: number;
  statusCounts: { pending: number; enriching: number; scoring: number; done: number };
  verdictCounts: { strong: number; possible: number; weak: number };
  thisWeek: number;
  lastWeek: number;
  newOpportunities: number;
  byUser: { ownerEmail: string | null; total: number; done: number; strong: number; possible: number; weak: number }[];
};

type LeadListsData = {
  totalLists: number;
  totalLeads: number;
  thisWeek: number;
  lastWeek: number;
  enrichmentStatusCounts: { idle: number; enriching: number; done: number; not_found: number; failed: number };
  phoneRevealStatusCounts: { requested: number; done: number; no_match: number; failed: number };
  byUser: { ownerEmail: string | null; lists: number; leads: number }[];
};

export default function AnalyticsRoute() {
  useSetPageTitle("Analytics");
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
          {isAdmin ? "Analytics is only available to workspace admins." : "Failed to load analytics."}
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
    trend: TrendPoint[];
    personas: PersonaAgg[];
    postEngagement: PostEngagementData;
    leadLists: LeadListsData;
  };

  const activeFeedbackCount = ((feedbackData as { feedback?: { resolvedAt: string | null }[] } | undefined)?.feedback ?? []).filter(
    (i) => !i.resolvedAt,
  ).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace-wide pipeline overview.</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="engagement">Engagement</TabsTrigger>
          <TabsTrigger value="lists">Lead Lists</TabsTrigger>
          <TabsTrigger value="feedback">
            Feedback{activeFeedbackCount > 0 ? ` (${activeFeedbackCount})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab d={d} />
        </TabsContent>
        <TabsContent value="prospects" className="mt-4">
          <ProspectsTab d={d} />
        </TabsContent>
        <TabsContent value="engagement" className="mt-4">
          <EngagementTab data={d.postEngagement} trend={d.trend} />
        </TabsContent>
        <TabsContent value="lists" className="mt-4">
          <LeadListsTab data={d.leadLists} trend={d.trend} />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <FeedbackSection feedbackData={feedbackData} refetch={refetchFeedback} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────

function OverviewTab({
  d,
}: {
  d: {
    totalProspects: number;
    totalSent: number;
    thisWeek: number;
    lastWeek: number;
    byUser: UserActivity[];
    trend: TrendPoint[];
    personas: PersonaAgg[];
    postEngagement: PostEngagementData;
    leadLists: LeadListsData;
  };
}) {
  const weekDiff = d.thisWeek - d.lastWeek;
  const { session } = useSession();
  const viewerEmail = session?.email ?? null;
  const [showAllLeaderboard, setShowAllLeaderboard] = useState(false);

  const combinedByUser = new Map<string, number>();
  for (const u of d.byUser) combinedByUser.set(u.ownerEmail ?? "Unassigned", (combinedByUser.get(u.ownerEmail ?? "Unassigned") ?? 0) + u.total);
  for (const u of d.postEngagement.byUser) combinedByUser.set(u.ownerEmail ?? "Unassigned", (combinedByUser.get(u.ownerEmail ?? "Unassigned") ?? 0) + u.total);
  for (const u of d.leadLists.byUser) combinedByUser.set(u.ownerEmail ?? "Unassigned", (combinedByUser.get(u.ownerEmail ?? "Unassigned") ?? 0) + u.leads);
  const leaderboardAll = [...combinedByUser.entries()]
    .map(([email, total]) => ({ email, total }))
    .sort((a, b) => b.total - a.total);

  // "Top 5 + you" instead of a hard top-8 cutoff with no way to find your own
  // row -- research on leaderboards (cited in the design doc this follows)
  // specifically warns against showing a full ranking with no way for a
  // lower-ranked viewer to see themselves without being made to feel last.
  const viewerIndex = leaderboardAll.findIndex((r) => r.email === viewerEmail);
  const top5 = leaderboardAll.slice(0, 5);
  const viewerInTop5 = viewerIndex !== -1 && viewerIndex < 5;
  const leaderboard = showAllLeaderboard
    ? leaderboardAll
    : viewerInTop5 || viewerIndex === -1
      ? top5
      : [...top5, leaderboardAll[viewerIndex]];
  const leaderboardTruncated = !showAllLeaderboard && leaderboardAll.length > leaderboard.length;

  return (
    <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
      <KpiCard
        label="Prospects"
        value={d.totalProspects}
        color={PIPELINE.prospects.color}
        sub={d.totalProspects === 0 ? "No profiles captured yet" : undefined}
      />
      <KpiCard
        label="Engagers"
        value={d.postEngagement.totalEngagers}
        color={PIPELINE.engagers.color}
        sub={d.postEngagement.totalEngagers === 0 ? "No post engagers captured yet" : undefined}
      />
      <KpiCard
        label="Leads"
        value={d.leadLists.totalLeads}
        color={PIPELINE.leads.color}
        sub={d.leadLists.totalLeads === 0 ? "No lead lists imported yet" : undefined}
      />
      <KpiCard
        label="This Week"
        value={d.thisWeek}
        sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
        subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
      />

      <BentoTile className="col-span-2 sm:col-span-4" title="Activity, last 14 days">
        <TrendChart
          data={[...d.trend]}
          series={[
            { key: "prospects", ...PIPELINE.prospects },
            { key: "engagers", ...PIPELINE.engagers },
            { key: "leads", ...PIPELINE.leads },
          ]}
          showLegend
        />
      </BentoTile>

      <BentoTile
        className="col-span-2"
        title="Team Leaderboard"
        sub="Prospects + engagers + leads, combined -- a rough activity signal, not a like-for-like comparison."
      >
        {leaderboard.length === 0 ? (
          <EmptyState icon={IconUsers} text="No activity yet." />
        ) : (
          <>
            <Leaderboard
              rows={leaderboard.map((r) => ({ label: emailToDisplayName(r.email), value: r.total, email: r.email }))}
              color="#6b7280"
              viewerEmail={viewerEmail}
            />
            {leaderboardTruncated ? (
              <button
                type="button"
                onClick={() => setShowAllLeaderboard(true)}
                className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Show all {leaderboardAll.length}
              </button>
            ) : showAllLeaderboard && leaderboardAll.length > 5 ? (
              <button
                type="button"
                onClick={() => setShowAllLeaderboard(false)}
                className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Show top 5
              </button>
            ) : null}
          </>
        )}
      </BentoTile>

      <BentoTile className="col-span-2" title="Personas" sub="Combined across all pipelines.">
        {d.personas.length === 0 ? (
          <EmptyState icon={IconUsers} text="No personas assigned yet." />
        ) : (
          <Leaderboard
            rows={d.personas.slice(0, 8).map((p) => ({ label: p.name, value: p.total, color: p.color ?? undefined }))}
            color="#6b7280"
          />
        )}
      </BentoTile>
    </div>
  );
}

// ── Prospects ───────────────────────────────────────────────────────────

function ProspectsTab({
  d,
}: {
  d: {
    totalProspects: number;
    verdictCounts: { strong: number; possible: number; weak: number };
    statusCounts: { captured: number; drafted: number; sent: number };
    thisWeek: number;
    lastWeek: number;
    totalSent: number;
    byUser: UserActivity[];
    trend: TrendPoint[];
  };
}) {
  const weekDiff = d.thisWeek - d.lastWeek;
  const sentRate = pct(d.totalSent, d.totalProspects);

  return (
    <div className="space-y-4">
      <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
        <KpiCard label="Total" value={d.totalProspects} color={PIPELINE.prospects.color} />
        <KpiCard
          label="This Week"
          value={d.thisWeek}
          sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
          subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
        />
        <KpiCard label="Sent" value={d.totalSent} sub={`${sentRate} send rate`} />
        <KpiCard label="Users" value={d.byUser.length} />

        <BentoTile className="col-span-2 sm:col-span-4" title="Activity, last 14 days">
          <TrendChart data={[...d.trend]} series={[{ key: "prospects", ...PIPELINE.prospects }]} height={160} />
        </BentoTile>

        <BentoTile className="col-span-2" title="Fit Verdict">
          <DonutBreakdown
            segments={[
              { label: "Strong", value: d.verdictCounts.strong, color: VERDICT_COLOR.strong },
              { label: "Possible", value: d.verdictCounts.possible, color: VERDICT_COLOR.possible },
              { label: "Weak", value: d.verdictCounts.weak, color: VERDICT_COLOR.weak },
            ]}
          />
        </BentoTile>

        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Status Funnel</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <FunnelRow label="Captured" count={d.statusCounts.captured} total={d.totalProspects} color={PIPELINE.prospects.color} />
            <FunnelRow label="Drafted" count={d.statusCounts.drafted} total={d.totalProspects} color={PIPELINE.prospects.color} />
            <FunnelRow label="Sent" count={d.statusCounts.sent} total={d.totalProspects} color={PIPELINE.prospects.color} />
          </CardContent>
        </Card>
      </div>

      <TeamSection
        title="By Teammate"
        rows={d.byUser.map((u) => ({ label: emailToDisplayName(u.ownerEmail ?? "Unassigned"), value: u.total, email: u.ownerEmail ?? "Unassigned" }))}
        color={PIPELINE.prospects.color}
        table={
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
              {d.byUser.map((u) => (
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
        }
      />
    </div>
  );
}

// ── Engagement ──────────────────────────────────────────────────────────

function EngagementTab({ data, trend }: { data: PostEngagementData; trend: TrendPoint[] }) {
  const weekDiff = data.thisWeek - data.lastWeek;

  if (data.totalEngagers === 0) {
    return <EmptyState icon={IconMessages} text="No post engagers captured yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
        <KpiCard label="Engagers" value={data.totalEngagers} sub={`across ${data.distinctPosts} post${data.distinctPosts === 1 ? "" : "s"}`} color={PIPELINE.engagers.color} />
        <KpiCard
          label="This Week"
          value={data.thisWeek}
          sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
          subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
        />
        <KpiCard label="Scored" value={data.statusCounts.done} sub={`${pct(data.statusCounts.done, data.totalEngagers)} of engagers`} />
        <KpiCard label="New Opportunities" value={data.newOpportunities} sub="no existing HubSpot contact" />

        <BentoTile className="col-span-2 sm:col-span-4" title="Activity, last 14 days">
          <TrendChart data={[...trend]} series={[{ key: "engagers", ...PIPELINE.engagers }]} height={160} />
        </BentoTile>

        <BentoTile className="col-span-2" title="Fit Verdict">
          <DonutBreakdown
            segments={[
              { label: "Strong", value: data.verdictCounts.strong, color: VERDICT_COLOR.strong },
              { label: "Possible", value: data.verdictCounts.possible, color: VERDICT_COLOR.possible },
              { label: "Weak", value: data.verdictCounts.weak, color: VERDICT_COLOR.weak },
            ]}
          />
        </BentoTile>

        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Enrichment Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <FunnelRow label="Pending" count={data.statusCounts.pending} total={data.totalEngagers} color={PIPELINE.engagers.color} />
            <FunnelRow label="Enriching" count={data.statusCounts.enriching} total={data.totalEngagers} color={PIPELINE.engagers.color} />
            <FunnelRow label="Scoring" count={data.statusCounts.scoring} total={data.totalEngagers} color={PIPELINE.engagers.color} />
            <FunnelRow label="Done" count={data.statusCounts.done} total={data.totalEngagers} color={PIPELINE.engagers.color} />
          </CardContent>
        </Card>
      </div>

      <TeamSection
        title="By Teammate"
        rows={data.byUser.map((u) => ({ label: emailToDisplayName(u.ownerEmail ?? "Unassigned"), value: u.total, email: u.ownerEmail ?? "Unassigned" }))}
        color={PIPELINE.engagers.color}
        table={
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Teammate</th>
                <th className="px-4 py-2 text-right font-medium">Engagers</th>
                <th className="px-4 py-2 text-right font-medium">Scored</th>
                <th className="px-4 py-2 text-right font-medium">Strong / Possible / Weak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.byUser.map((u) => (
                <tr key={u.ownerEmail ?? "unassigned"}>
                  <td className="px-4 py-2.5 font-medium">{u.ownerEmail ?? "Unassigned"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.total.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.done.toLocaleString()}</td>
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
        }
      />
    </div>
  );
}

// ── Lead Lists ──────────────────────────────────────────────────────────

function LeadListsTab({ data, trend }: { data: LeadListsData; trend: TrendPoint[] }) {
  const weekDiff = data.thisWeek - data.lastWeek;
  const phoneRevealTotal =
    data.phoneRevealStatusCounts.requested + data.phoneRevealStatusCounts.done + data.phoneRevealStatusCounts.no_match + data.phoneRevealStatusCounts.failed;

  if (data.totalLists === 0) {
    return <EmptyState icon={IconListCheck} text="No lead lists imported yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
        <KpiCard label="Lists" value={data.totalLists} color={PIPELINE.leads.color} />
        <KpiCard label="Leads" value={data.totalLeads} color={PIPELINE.leads.color} />
        <KpiCard
          label="Leads This Week"
          value={data.thisWeek}
          sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
          subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
        />
        <KpiCard label="Enriched" value={data.enrichmentStatusCounts.done} sub={`${pct(data.enrichmentStatusCounts.done, data.totalLeads)} of leads`} />

        <BentoTile className="col-span-2 sm:col-span-4" title="Activity, last 14 days">
          <TrendChart data={[...trend]} series={[{ key: "leads", ...PIPELINE.leads }]} height={160} />
        </BentoTile>

        <BentoTile className="col-span-2" title="Apollo Enrichment" sub="Enrichment is per-lead and on-demand, so most leads sit unenriched until someone clicks Enrich.">
          <DonutBreakdown
            segments={[
              { label: "Enriched", value: data.enrichmentStatusCounts.done, color: "#10b981" },
              { label: "Not Found", value: data.enrichmentStatusCounts.not_found, color: "#9ca3af" },
              { label: "Failed", value: data.enrichmentStatusCounts.failed, color: VERDICT_COLOR.weak },
              { label: "Enriching", value: data.enrichmentStatusCounts.enriching, color: PIPELINE.leads.color },
              { label: "Not Enriched", value: data.enrichmentStatusCounts.idle, color: "#d1d5db" },
            ]}
          />
        </BentoTile>

        <BentoTile className="col-span-2" title="Phone Reveal">
          {phoneRevealTotal === 0 ? (
            <EmptyState icon={IconListCheck} text="No phone reveals attempted yet." compact />
          ) : (
            <DonutBreakdown
              segments={[
                { label: "Revealed", value: data.phoneRevealStatusCounts.done, color: "#10b981" },
                { label: "No Match", value: data.phoneRevealStatusCounts.no_match, color: "#9ca3af" },
                { label: "Requested", value: data.phoneRevealStatusCounts.requested, color: PIPELINE.leads.color },
                { label: "Failed", value: data.phoneRevealStatusCounts.failed, color: VERDICT_COLOR.weak },
              ]}
            />
          )}
        </BentoTile>
      </div>

      <TeamSection
        title="By Teammate"
        rows={data.byUser.map((u) => ({ label: emailToDisplayName(u.ownerEmail ?? "Unassigned"), value: u.leads, email: u.ownerEmail ?? "Unassigned" }))}
        color={PIPELINE.leads.color}
        table={
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Teammate</th>
                <th className="px-4 py-2 text-right font-medium">Lists</th>
                <th className="px-4 py-2 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.byUser.map((u) => (
                <tr key={u.ownerEmail ?? "unassigned"}>
                  <td className="px-4 py-2.5 font-medium">{u.ownerEmail ?? "Unassigned"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.lists.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.leads.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
    </div>
  );
}

// ── Shared chart primitives ─────────────────────────────────────────────

function TrendChart({
  data,
  series,
  height = 220,
  showLegend = false,
}: {
  data: TrendPoint[];
  series: { key: "prospects" | "engagers" | "leads"; label: string; color: string }[];
  height?: number;
  showLegend?: boolean;
}) {
  const total = data.reduce((sum, point) => sum + series.reduce((s, ser) => s + (point[ser.key] ?? 0), 0), 0);
  if (total === 0) {
    return <EmptyState icon={IconChartBar} text="No activity in the last 14 days yet." compact />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke={AXIS_COLOR} strokeOpacity={0.15} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} interval={1} />
        <YAxis tick={{ fontSize: 11, fill: AXIS_COLOR }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }}
          labelStyle={{ fontWeight: 600 }}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#fill-${s.key})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function DonutBreakdown({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const visible = segments.filter((s) => s.value > 0);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return <EmptyState icon={IconChartBar} text="No data yet." compact />;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={visible} dataKey="value" nameKey="label" innerRadius={42} outerRadius={64} paddingAngle={2} strokeWidth={0}>
              {visible.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold tabular-nums">{total.toLocaleString()}</span>
          <span className="text-[10px] text-muted-foreground">total</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{s.value.toLocaleString()}</span>
            <span className="w-9 text-right text-muted-foreground">{pct(s.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({
  rows,
  color,
  viewerEmail,
}: {
  rows: { label: string; value: number; color?: string; email?: string }[];
  color: string;
  viewerEmail?: string | null;
}) {
  const height = Math.max(60, rows.length * 34);
  // Append "(You)" and give the viewer's own row a distinct bar color --
  // bolding just one Y-axis tick label would need a custom Recharts tick
  // renderer, whereas this is a guaranteed-visible signal with no extra
  // machinery.
  const displayRows = rows.map((r) => ({
    ...r,
    label: r.email && viewerEmail && r.email === viewerEmail ? `${r.label} (You)` : r.label,
    color: r.email && viewerEmail && r.email === viewerEmail ? "#0a66c2" : r.color,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={displayRows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={168}
          tick={{ fontSize: 12, fill: AXIS_COLOR }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }} cursor={{ fill: "rgba(128,128,128,0.08)" }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 11, fill: "currentColor" }}>
          {displayRows.map((r, i) => (
            <Cell key={`${r.label}-${i}`} fill={r.color ?? color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function BentoTile({ title, sub, className, children }: { title: string; sub?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function TeamSection({
  title,
  rows,
  color,
  table,
}: {
  title: string;
  rows: { label: string; value: number; email?: string }[];
  color: string;
  table: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const { session } = useSession();
  if (rows.length === 0) {
    return <EmptyState icon={IconUsers} text="No activity yet." />;
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {showTable ? "Show chart" : "Show table"}
        </button>
      </CardHeader>
      <CardContent className={showTable ? "overflow-x-auto p-0" : undefined}>
        {showTable ? table : (
          <Leaderboard
            rows={[...rows].sort((a, b) => b.value - a.value)}
            color={color}
            viewerEmail={session?.email ?? null}
          />
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({ label, value, sub, subColor, color }: { label: string; value: number; sub?: string; subColor?: string; color?: string }) {
  return (
    <Card className="overflow-hidden">
      {color && <div className="h-1" style={{ backgroundColor: color }} />}
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        {sub && <p className={`mt-0.5 text-[11px] ${subColor ?? "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

function FunnelRow({ label, count, total, color }: { label: string; count: number; total: number; color?: string }) {
  const width = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="w-20 text-sm text-muted-foreground">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-muted h-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color ?? "currentColor" }} />
      </div>
      <span className="w-10 text-right text-sm font-medium tabular-nums">{count.toLocaleString()}</span>
      <span className="w-9 text-right text-xs text-muted-foreground">{pct(count, total)}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, text, compact }: { icon: React.ComponentType<{ className?: string }>; text: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-border text-center ${compact ? "py-6" : "py-10"}`}>
      <Icon className="size-7 text-muted-foreground/30" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────

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
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 text-emerald-600">
            <IconThumbUp size={12} /> {positiveCount}
          </span>
          <span className="flex items-center gap-1 text-rose-500">
            <IconThumbDown size={12} /> {negativeCount}
          </span>
        </div>
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border border-border bg-muted/40 p-1 w-fit">
        <button
          onClick={() => setTab("active")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Active
          {active.length > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{active.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab("resolved")}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            tab === "resolved" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Resolved
          {resolved.length > 0 && (
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{resolved.length}</span>
          )}
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={IconMessageReport} text={tab === "active" ? "No active feedback." : "No resolved feedback yet."} />
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
                  <span className="truncate text-xs font-medium text-muted-foreground">{item.userEmail ?? "Anonymous"}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground/60">{formatDate(item.createdAt)}</span>
                    <button
                      onClick={() => handleResolve(item.id, !!item.resolvedAt)}
                      disabled={isPending}
                      title={item.resolvedAt ? "Mark as active" : "Mark as resolved"}
                      className={`rounded p-0.5 transition-colors ${
                        item.resolvedAt ? "text-muted-foreground/40 hover:text-foreground" : "text-muted-foreground/40 hover:text-emerald-600"
                      }`}
                    >
                      <IconCheck size={14} />
                    </button>
                  </div>
                </div>
                {item.message && <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>}
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
