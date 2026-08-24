import { useActionQuery, useSession } from "@agent-native/core/client/hooks";
import { IconChartBar, IconLoader2, IconRefresh, IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DonutBreakdown, EmptyState, pct } from "@/components/DonutBreakdown";
import { APP_TITLE } from "@/lib/app-config";

// Same visual grammar as apps/li-agent/app/routes/analytics.tsx (KpiCard,
// BentoTile, DonutBreakdown, FunnelRow, Leaderboard, TeamSection,
// EmptyState) so the two apps' dashboards read as one product family, built
// on recharts (already an installed dependency here, previously unused).

// One accent color per source -- reused for that source's KPI accent, trend
// line, and leaderboard bars, matching the exact hues SourceBadge.tsx
// already uses for these same three sources elsewhere in the app (Tailwind
// orange/purple/teal-500), so a reader learns one color-to-source mapping
// once and it holds everywhere.
const SOURCE = {
  hubspot: { label: "HubSpot", color: "#f97316" },
  commonroom: { label: "CommonRoom", color: "#a855f7" },
  prospector: { label: "Prospector", color: "#14b8a6" },
} as const;

// Matches ScorePill.tsx's scoreBadge() thresholds/semantics exactly (>=80
// Excellent/emerald, >=50 Good/amber, else Weak/muted) so a donut segment
// color never disagrees with the score pill a contact shows in the table.
const SCORE_COLOR = { excellent: "#10b981", good: "#f59e0b", weak: "#9ca3af", unscored: "#d1d5db" };
const AXIS_COLOR = "#9ca3af";

export function meta() {
  return [{ title: `${APP_TITLE} — Analytics` }];
}

// No display-name column exists for a workspace user -- leaderboards only
// ever have an email to show. Formats the local-part into a readable name.
function emailToDisplayName(email: string): string {
  if (email === "Unassigned") return email;
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

type TrendPoint = { date: string; label: string; hubspot: number; commonroom: number; prospector: number };
type PersonaAgg = { id: string; name: string; color: string | null; total: number };
type UserActivity = { userEmail: string | null; segmentsCreated: number; contactsActioned: number; syncRuns: number; total: number };

interface AnalyticsSummary {
  totalContacts: number;
  activeContacts: number;
  scoreBuckets: { excellent: number; good: number; weak: number; unscored: number };
  bySource: { hubspot: number; commonroom: number; prospector: number };
  personas: PersonaAgg[];
  trend: TrendPoint[];
  thisWeek: number;
  lastWeek: number;
  segmentsCreated: { total: number; last30Days: number };
  contactsActioned: { total: number; last30Days: number };
  syncRuns: {
    total: number;
    successCount: number;
    failedCount: number;
    bySource: { hubspot: number; commonroom: number; prospector: number };
  };
  byUser: UserActivity[];
}

export default function AnalyticsRoute() {
  const { data, isLoading, error } = useActionQuery("get-analytics-summary", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    const msg = error instanceof Error ? error.message : String(error ?? "");
    const isForbidden = msg.toLowerCase().includes("denied") || msg.includes("403");
    return (
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <IconChartBar className="mx-auto mb-3 size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          {isForbidden ? "You don't have access to analytics." : "Unable to load analytics."}
        </p>
      </div>
    );
  }

  const d = data as AnalyticsSummary;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Adoption and sync health across the workspace.</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="sync">Sync Health</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab d={d} />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <ContactsTab d={d} />
        </TabsContent>
        <TabsContent value="sync" className="mt-4">
          <SyncHealthTab d={d} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ d }: { d: AnalyticsSummary }) {
  const weekDiff = d.thisWeek - d.lastWeek;
  const { session } = useSession();
  const viewerEmail = session?.email ?? null;

  return (
    <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
      <KpiCard label="Total Contacts" value={d.totalContacts} sub={d.totalContacts === 0 ? "No contacts synced yet" : undefined} />
      <KpiCard label="Active" value={d.activeContacts} sub={`${pct(d.activeContacts, d.totalContacts)} of total`} />
      <KpiCard
        label="Actioned This Week"
        value={d.thisWeek}
        sub={weekDiff === 0 ? "same as last week" : weekDiff > 0 ? `+${weekDiff} vs last week` : `${weekDiff} vs last week`}
        subColor={weekDiff > 0 ? "text-emerald-600" : weekDiff < 0 ? "text-rose-500" : undefined}
      />
      <KpiCard label="Sync Runs" value={d.syncRuns.total} sub={`${d.syncRuns.successCount.toLocaleString()} succeeded`} />

      <BentoTile className="col-span-2 sm:col-span-4" title="Contacts synced, last 14 days">
        <TrendChart data={d.trend} />
      </BentoTile>

      <BentoTile className="col-span-2" title="Team Leaderboard" sub="Segments created + contacts actioned + sync runs, combined.">
        {d.byUser.length === 0 ? (
          <EmptyState icon={IconUsers} text="No activity yet." />
        ) : (
          <Leaderboard
            rows={d.byUser.map((u) => ({
              label: emailToDisplayName(u.userEmail ?? "Unassigned"),
              value: u.total,
              email: u.userEmail ?? "Unassigned",
            }))}
            color="#6b7280"
            viewerEmail={viewerEmail}
          />
        )}
      </BentoTile>

      <BentoTile className="col-span-2" title="Personas" sub="Active contacts by matched persona.">
        {d.personas.length === 0 ? (
          <EmptyState icon={IconUsers} text="No contacts matched to a persona yet." />
        ) : (
          <Leaderboard rows={d.personas.slice(0, 8).map((p) => ({ label: p.name, value: p.total, color: p.color ?? undefined }))} color="#6b7280" />
        )}
      </BentoTile>
    </div>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────

function ContactsTab({ d }: { d: AnalyticsSummary }) {
  const scoreTotal = d.scoreBuckets.excellent + d.scoreBuckets.good + d.scoreBuckets.weak + d.scoreBuckets.unscored;
  const sourceTotal = d.bySource.hubspot + d.bySource.commonroom + d.bySource.prospector;

  return (
    <div className="space-y-4">
      <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
        <KpiCard label="Total" value={d.totalContacts} />
        <KpiCard label="Active" value={d.activeContacts} />
        <KpiCard label="Actioned" value={d.contactsActioned.total} sub={`${d.contactsActioned.last30Days.toLocaleString()} in last 30 days`} />
        <KpiCard label="Personas Matched" value={d.personas.length} />

        <BentoTile className="col-span-2 sm:col-span-4" title="Contacts synced, last 14 days">
          <TrendChart data={d.trend} height={160} showLegend />
        </BentoTile>

        <BentoTile className="col-span-2" title="Score Distribution">
          <DonutBreakdown
            segments={[
              { label: "Excellent", value: d.scoreBuckets.excellent, color: SCORE_COLOR.excellent },
              { label: "Good", value: d.scoreBuckets.good, color: SCORE_COLOR.good },
              { label: "Weak", value: d.scoreBuckets.weak, color: SCORE_COLOR.weak },
              { label: "Unscored", value: d.scoreBuckets.unscored, color: SCORE_COLOR.unscored },
            ]}
          />
        </BentoTile>

        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">By Source</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <FunnelRow label="HubSpot" count={d.bySource.hubspot} total={sourceTotal} color={SOURCE.hubspot.color} />
            <FunnelRow label="CommonRoom" count={d.bySource.commonroom} total={sourceTotal} color={SOURCE.commonroom.color} />
            <FunnelRow label="Prospector" count={d.bySource.prospector} total={sourceTotal} color={SOURCE.prospector.color} />
          </CardContent>
        </Card>
      </div>

      <TeamSection
        title="By Teammate"
        rows={d.byUser.map((u) => ({ label: emailToDisplayName(u.userEmail ?? "Unassigned"), value: u.contactsActioned, email: u.userEmail ?? "Unassigned" }))}
        color="#6b7280"
        table={
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Teammate</th>
                <th className="px-4 py-2 text-right font-medium">Contacts Actioned</th>
                <th className="px-4 py-2 text-right font-medium">Segments Created</th>
                <th className="px-4 py-2 text-right font-medium">Sync Runs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.byUser.map((u) => (
                <tr key={u.userEmail ?? "unassigned"}>
                  <td className="px-4 py-2.5 font-medium">{u.userEmail ?? "Unassigned"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.contactsActioned.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.segmentsCreated.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.syncRuns.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      />
      {scoreTotal === 0 && <EmptyState icon={IconChartBar} text="No active contacts to score yet." />}
    </div>
  );
}

// ── Sync Health ──────────────────────────────────────────────────────────

function SyncHealthTab({ d }: { d: AnalyticsSummary }) {
  const runsBySourceTotal = d.syncRuns.bySource.hubspot + d.syncRuns.bySource.commonroom + d.syncRuns.bySource.prospector;

  if (d.syncRuns.total === 0) {
    return <EmptyState icon={IconRefresh} text="No sync runs yet." />;
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start grid-cols-2 gap-3 sm:grid-cols-4 sm:auto-rows-min">
        <KpiCard label="Total Runs" value={d.syncRuns.total} />
        <KpiCard label="Succeeded" value={d.syncRuns.successCount} sub={pct(d.syncRuns.successCount, d.syncRuns.total)} subColor="text-emerald-600" />
        <KpiCard label="Failed" value={d.syncRuns.failedCount} sub={pct(d.syncRuns.failedCount, d.syncRuns.total)} subColor={d.syncRuns.failedCount > 0 ? "text-rose-500" : undefined} />
        <KpiCard label="Segments Created" value={d.segmentsCreated.total} sub={`${d.segmentsCreated.last30Days.toLocaleString()} in last 30 days`} />

        <BentoTile className="col-span-2" title="Run Outcome">
          <DonutBreakdown
            segments={[
              { label: "Succeeded", value: d.syncRuns.successCount, color: "#10b981" },
              { label: "Failed", value: d.syncRuns.failedCount, color: "#f43f5e" },
            ]}
          />
        </BentoTile>

        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Runs by Source</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <FunnelRow label="HubSpot" count={d.syncRuns.bySource.hubspot} total={runsBySourceTotal} color={SOURCE.hubspot.color} />
            <FunnelRow label="CommonRoom" count={d.syncRuns.bySource.commonroom} total={runsBySourceTotal} color={SOURCE.commonroom.color} />
            <FunnelRow label="Prospector" count={d.syncRuns.bySource.prospector} total={runsBySourceTotal} color={SOURCE.prospector.color} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Shared chart primitives ──────────────────────────────────────────────
// Ported from apps/li-agent/app/routes/analytics.tsx -- generic, data-shape
// agnostic, kept visually identical so both apps' dashboards read as one.

function TrendChart({ data, height = 220, showLegend = false }: { data: TrendPoint[]; height?: number; showLegend?: boolean }) {
  const total = data.reduce((sum, point) => sum + point.hubspot + point.commonroom + point.prospector, 0);
  if (total === 0) {
    return <EmptyState icon={IconChartBar} text="No activity in the last 14 days yet." compact />;
  }

  const series = [
    { key: "hubspot" as const, ...SOURCE.hubspot },
    { key: "commonroom" as const, ...SOURCE.commonroom },
    { key: "prospector" as const, ...SOURCE.prospector },
  ];

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
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(128,128,128,0.2)" }} labelStyle={{ fontWeight: 600 }} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#fill-${s.key})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Leaderboard({ rows, color, viewerEmail }: { rows: { label: string; value: number; color?: string; email?: string }[]; color: string; viewerEmail?: string | null }) {
  const height = Math.max(60, rows.length * 34);
  const displayRows = rows.map((r) => ({
    ...r,
    label: r.email && viewerEmail && r.email === viewerEmail ? `${r.label} (You)` : r.label,
    color: r.email && viewerEmail && r.email === viewerEmail ? "#0d9488" : r.color,
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={displayRows} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={168} tick={{ fontSize: 12, fill: AXIS_COLOR }} axisLine={false} tickLine={false} />
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

function TeamSection({ title, rows, color, table }: { title: string; rows: { label: string; value: number; email?: string }[]; color: string; table: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  const { session } = useSession();
  if (rows.length === 0) {
    return <EmptyState icon={IconUsers} text="No activity yet." />;
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
          {showTable ? "Show chart" : "Show table"}
        </button>
      </CardHeader>
      <CardContent className={showTable ? "overflow-x-auto p-0" : undefined}>
        {showTable ? table : <Leaderboard rows={[...rows].sort((a, b) => b.value - a.value)} color={color} viewerEmail={session?.email ?? null} />}
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
      <span className="w-24 text-sm text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color ?? "currentColor" }} />
      </div>
      <span className="w-10 text-right text-sm font-medium tabular-nums">{count.toLocaleString()}</span>
      <span className="w-9 text-right text-xs text-muted-foreground">{pct(count, total)}</span>
    </div>
  );
}

