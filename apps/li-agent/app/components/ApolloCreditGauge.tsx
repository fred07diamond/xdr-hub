import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { IconAlertTriangle, IconCoins, IconDownload, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { csvEscape } from "@/lib/prospects-csv";

// Read-side credit surfaces: the Analytics gauge and the app-wide low-credit
// banner.
//
// Both use the SAME react-query key (`get-apollo-credit-usage` with no params),
// so mounting the banner on every route costs one shared poll rather than one
// per consumer -- the cost popovers on Prospects and Lead Lists ride the same
// query.

/** Poll settings shared by every consumer, so they collapse into one query. */
const USAGE_QUERY_OPTIONS = {
  refetchInterval: 120_000,
  // Deliberately not polling a hidden tab: an idle dashboard left open
  // overnight should not generate a request every two minutes.
  refetchIntervalInBackground: false,
} as const;

export interface CreditUsage {
  enabled: boolean;
  tier: string;
  periodStart: string;
  resetLabel: string;
  budget: number;
  spent: number;
  remaining: number;
  spentPct: number;
  emailCredits: number;
  emailCalls: number;
  phoneCredits: number;
  phoneCalls: number;
  sweepCredits: number;
  manualCredits: number;
  sweepCap: number;
  overrideCount: number;
  overrideCredits: number;
  /** Credits charged that returned nothing usable. */
  wastedCredits: number;
  /** Credits spent on weak-fit leads or via a fit-gate override. */
  lowFitCredits: number;
  /** Lookups that came back empty. Free, which is the point of showing it. */
  emptyCalls: number;
  phoneStopAt: number;
  phoneStopPct: number;
  /** Fit bars, exposed to every member so the UI can explain a skip. */
  enrichMinVerdict?: string;
  phoneMinVerdict?: string;
  thresholds: number[];
  topSpenders?: {
    actorEmail: string;
    credits: number;
    calls: number;
    delivered: number;
    wasted: number;
    lowFit: number;
    emptyCalls: number;
    emailCredits: number;
    phoneCredits: number;
  }[];
  /**
   * The caller's own figures. Present for every signed-in member, unlike
   * topSpenders -- an xDR needs to see their own cap coming.
   */
  mine?: {
    email: string | null;
    credits: number;
    emailCredits: number;
    phoneCredits: number;
    delivered: number;
    wasted: number;
    lowFit: number;
    limit: number;
    remaining: number;
    isDefaultLimit: boolean;
  };
}

export function useCreditUsage() {
  return useActionQuery("get-apollo-credit-usage", {}, USAGE_QUERY_OPTIONS);
}

// ── Analytics gauge ─────────────────────────────────────────────────────

/**
 * Compact credit strip for the Analytics Overview tab.
 *
 * Shows the VIEWER'S OWN allowance, not the workspace total. On Overview the
 * actionable question is "how much can I still spend?", and the workspace
 * figure does not answer it -- a personal cap of 2,000 against a workspace
 * budget of 27,996 means the number that will actually stop an xDR is their
 * own. The workspace picture is an admin concern and lives on the Credits tab.
 *
 * The one workspace fact kept here is the tier: when enrichment is stopped or
 * phones are paused workspace-wide, a healthy personal balance is misleading,
 * because the thing blocking them is not their own limit.
 */
export function CreditGaugeCard({
  className,
  onOpenDetails,
}: {
  className?: string;
  onOpenDetails?: () => void;
}) {
  const { data, isLoading } = useCreditUsage();
  const d = data as CreditUsage | undefined;

  if (isLoading || !d) return null;

  const mine = d.mine;
  // No personal figures means no session to attribute spend to. The workspace
  // view is a tab away; do not silently substitute it here.
  if (!mine) return null;

  const limit = mine.limit;
  const pct = limit > 0 ? Math.min(100, (mine.credits / limit) * 100) : 0;
  const emailPct = limit > 0 ? Math.min(100, (mine.emailCredits / limit) * 100) : 0;
  const phonePct = limit > 0 ? Math.min(100 - emailPct, (mine.phoneCredits / limit) * 100) : 0;

  const personalExhausted = mine.remaining === 0 && limit > 0;
  const workspaceStopped = d.spentPct >= 100;
  const phonesPaused = d.spentPct >= d.phoneStopPct;

  return (
    <div
      id="apollo-credits"
      className={`scroll-mt-16 rounded-xl border border-border bg-card p-4 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <IconCoins size={15} />
            Your Apollo Credits
          </h3>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
            <span
              className={`text-2xl font-semibold tabular-nums ${personalExhausted || workspaceStopped ? "text-destructive" : "text-foreground"}`}
            >
              {mine.remaining.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">/ {limit.toLocaleString()} available</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {d.enabled ? `Renews ${d.resetLabel}` : "Enrichment is off — nothing is being spent"}
          </p>
        </div>

        <div className="min-w-[180px] flex-1">
          {/* Their spend against THEIR limit. No phone-pause tick here: that
              threshold is a percentage of the workspace budget, so marking it
              on a personal bar would put it at a meaningless position. */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-sky-500" style={{ width: `${emailPct}%` }} title="Emails" />
            <div className="h-full bg-violet-500" style={{ width: `${phonePct}%` }} title="Phone reveals" />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>
              <b className="font-semibold tabular-nums text-foreground">{mine.credits.toLocaleString()}</b> used
              ({Math.round(pct)}%)
            </span>
            {mine.credits > 0 && (
              <span>
                {mine.emailCredits.toLocaleString()} on emails, {mine.phoneCredits.toLocaleString()} on phones
              </span>
            )}
            {mine.lowFit > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {mine.lowFit.toLocaleString()} on low-fit leads
              </span>
            )}
            {mine.wasted > 0 && (
              <span className="text-destructive">{mine.wasted.toLocaleString()} wasted</span>
            )}
          </p>

          {/* Workspace-level blocks override a healthy personal balance, so
              they are stated rather than left to be discovered on a failed
              click. */}
          {d.enabled && (workspaceStopped || phonesPaused) && (
            <p
              className={`mt-1 text-[11px] ${workspaceStopped ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
            >
              {workspaceStopped
                ? `The workspace has used its whole budget — enrichment is paused for everyone until ${d.resetLabel}.`
                : "The workspace is past 80% — phone reveals are paused for everyone, emails still work."}
            </p>
          )}
          {d.enabled && !workspaceStopped && personalExhausted && (
            <p className="mt-1 text-[11px] text-destructive">
              You have used your whole allowance for this period. Ask an admin to raise it, or wait for{" "}
              {d.resetLabel}.
            </p>
          )}
        </div>

        {onOpenDetails && (
          <button
            type="button"
            onClick={onOpenDetails}
            className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Credit details
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Downloads the credit ledger for a period.
 *
 * This is the artifact the credit pilot runs on: several Apollo billing
 * behaviours cannot be determined from the API (whether a combined
 * match+reveal is 9 or 8, whether org-enrich bills at all), so the only way to
 * resolve them is to export a period and compare the total against Apollo's
 * real balance. `reprice-apollo-credit-ledger` then applies the correction.
 *
 * Uses `callAction` with an explicit GET rather than a hook, for two reasons:
 *
 * - The action declares `http: { method: "GET" }` because it is a read.
 *   `useActionMutation` POSTs, which the framework rejects outright -- the bug
 *   this replaced.
 * - `useActionQuery` would issue the GET on mount, so simply opening Analytics
 *   would run a 5,000-row ledger scan nobody asked for. An export has to stay
 *   on demand.
 */
export function LedgerExportButton({ periodStart }: { periodStart: string }) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setIsPending(true);
    try {
      const result = await callAction<{
        rows?: Record<string, unknown>[];
        truncated?: boolean;
      }>("list-apollo-credit-ledger", { periodStart }, { method: "GET" });

      const rows = result?.rows ?? [];
      if (rows.length === 0) {
        setError("No credits spent this period yet.");
        return;
      }
      const cols = [
        "createdAt",
        "unit",
        "creditsCharged",
        "estimatedCredits",
        "actualCredits",
        "reconciled",
        "status",
        "trigger",
        "actorEmail",
        "fitVerdict",
        "isOverride",
        "outcome",
        "subjectTable",
        "subjectId",
        "apolloPersonId",
        "note",
      ];
      const csv = [
        cols.join(","),
        ...rows.map((r) => cols.map((c) => csvEscape(r[c] as string | number | null)).join(",")),
      ].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apollo-credit-ledger-${periodStart}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (result?.truncated) setError("Hit the row cap — this export is partial.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export the ledger.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={isPending}
        title="Every charged call this period, for reconciling against an Apollo invoice."
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <IconDownload size={13} />
        {isPending ? "Exporting…" : "Export ledger"}
      </button>
      {error && <p className="max-w-[220px] text-right text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// ── App-wide banner ─────────────────────────────────────────────────────

/**
 * Keyed by `tier:periodStart`, deliberately.
 *
 * Dismissing the 80% warning must NOT suppress the later 100% banner -- those
 * are different facts -- and a new billing period must re-show both. A single
 * "dismissed" flag would silently hide the one message that actually matters.
 */
function dismissKey(tier: string, periodStart: string) {
  return `apollo.credit.banner.dismissed:${tier}:${periodStart}`;
}

export function ApolloCreditBanner() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string } | undefined)?.role === "admin";
  const { data } = useCreditUsage();
  const d = data as CreditUsage | undefined;
  const [dismissed, setDismissed] = useState(true);

  const tier = d?.tier ?? "";
  const periodStart = d?.periodStart ?? "";

  useEffect(() => {
    if (!tier || !periodStart) return;
    try {
      setDismissed(localStorage.getItem(dismissKey(tier, periodStart)) === "1");
    } catch {
      // Private-mode storage refusal is not a reason to hide a spend warning.
      setDismissed(false);
    }
  }, [tier, periodStart]);

  if (!isAdmin || !d || !d.enabled) return null;
  // `ok` means nothing worth interrupting anyone over.
  if (d.tier === "ok" || !tier) return null;
  if (dismissed) return null;

  const atLimit = d.spentPct >= 100;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(tier, periodStart), "1");
    } catch {
      // Dismissal not persisting is a minor annoyance, not an error worth showing.
    }
  }

  return (
    <div
      className={`flex items-start gap-2.5 border-b px-4 py-2.5 text-sm ${
        atLimit
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
    >
      <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {atLimit
            ? "Apollo credits are used up"
            : `Apollo credits ${Math.round(d.spentPct)}% spent`}
        </p>
        <p className="text-xs opacity-90">
          {atLimit
            ? `Enrichment is paused until ${d.resetLabel}. ${d.spent.toLocaleString()} of ${d.budget.toLocaleString()} credits used.`
            : `${d.remaining.toLocaleString()} of ${d.budget.toLocaleString()} left, resets ${d.resetLabel}.` +
              (d.spentPct >= d.phoneStopPct ? " Phone reveals are paused; emails still work." : "")}{" "}
          <Link to="/settings#apollo-credits" className="underline underline-offset-2">
            Adjust the budget
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
