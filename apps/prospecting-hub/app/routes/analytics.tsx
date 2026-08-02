import { useActionQuery } from "@agent-native/core/client";
import {
  IconChartBar,
  IconLoader2,
  IconRefresh,
  IconTargetArrow,
  IconUserCheck,
} from "@tabler/icons-react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Analytics` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsSummary {
  segmentsCreated: { total: number; last30Days: number };
  contactsActioned: { total: number; last30Days: number };
  syncRuns: {
    total: number;
    successCount: number;
    failedCount: number;
    bySource: { hubspot: number; commonroom: number };
  };
  contactsBySource: { hubspot: number; commonroom: number };
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  total,
  last30Days,
}: {
  icon: typeof IconChartBar;
  label: string;
  total: number;
  last30Days: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon size={14} />
        {label}
      </div>
      <p className="text-2xl font-semibold text-foreground">{total.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground/70">
        {last30Days.toLocaleString()} in the last 30 days
      </p>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function AnalyticsRoute() {
  const { data, isLoading } = useActionQuery("get-analytics-summary", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });

  const summary = data as AnalyticsSummary | undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : "Adoption and sync health across the workspace"}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : !summary ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Unable to load analytics.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard
                icon={IconTargetArrow}
                label="Lists created"
                total={summary.segmentsCreated.total}
                last30Days={summary.segmentsCreated.last30Days}
              />
              <SummaryCard
                icon={IconUserCheck}
                label="Contacts actioned"
                total={summary.contactsActioned.total}
                last30Days={summary.contactsActioned.last30Days}
              />
              <SummaryCard
                icon={IconRefresh}
                label="Sync runs"
                total={summary.syncRuns.total}
                last30Days={summary.syncRuns.successCount}
              />
            </div>

            <div>
              <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
                Sync runs by source
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Source</th>
                      <th className="px-4 py-2 font-medium">Runs</th>
                      <th className="px-4 py-2 font-medium">Active contacts</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-foreground">HubSpot</td>
                      <td className="px-4 py-2.5 text-foreground">
                        {summary.syncRuns.bySource.hubspot.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {summary.contactsBySource.hubspot.toLocaleString()}
                      </td>
                    </tr>
                    <tr className="last:border-0">
                      <td className="px-4 py-2.5 text-foreground">CommonRoom</td>
                      <td className="px-4 py-2.5 text-foreground">
                        {summary.syncRuns.bySource.commonroom.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {summary.contactsBySource.commonroom.toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground/70">
                {summary.syncRuns.successCount.toLocaleString()} succeeded ·{" "}
                {summary.syncRuns.failedCount.toLocaleString()} failed ·{" "}
                {summary.syncRuns.total.toLocaleString()} total runs
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
