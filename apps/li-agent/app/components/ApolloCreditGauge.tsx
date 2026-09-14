import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconAlertTriangle, IconCoins, IconDownload, IconPhoneOff, IconX } from "@tabler/icons-react";
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
  phoneStopAt: number;
  phoneStopPct: number;
  thresholds: number[];
  topSpenders?: { actorEmail: string; credits: number; calls: number }[];
}

export function useCreditUsage() {
  return useActionQuery("get-apollo-credit-usage", {}, USAGE_QUERY_OPTIONS);
}

// ── Analytics gauge ─────────────────────────────────────────────────────

export function CreditGaugeCard({ className }: { className?: string }) {
  const { data, isLoading } = useCreditUsage();
  const d = data as CreditUsage | undefined;

  if (isLoading || !d) return null;

  const pct = d.budget > 0 ? Math.min(100, (d.spent / d.budget) * 100) : 0;
  const emailPct = d.budget > 0 ? Math.min(100, (d.emailCredits / d.budget) * 100) : 0;
  const phonePct = d.budget > 0 ? Math.min(100 - emailPct, (d.phoneCredits / d.budget) * 100) : 0;
  const overBar = pct >= 100;
  const phonesPaused = pct >= d.phoneStopPct;

  return (
    <div
      id="apollo-credits"
      className={`scroll-mt-16 rounded-xl border border-border bg-card p-4 ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <IconCoins size={15} />
            Apollo Credits
          </h3>
          <p className="text-xs text-muted-foreground">
            {d.enabled ? `Resets ${d.resetLabel}` : "Enrichment is turned off — no credits are being spent."}
          </p>
        </div>
        <div className="text-right">
          <p
            className={`text-2xl font-semibold tabular-nums ${overBar ? "text-destructive" : phonesPaused ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
          >
            {d.remaining.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">
            left of {d.budget.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Stacked email/phone/remaining bar with the phone-pause point marked as
          a tick. Splitting the spend by unit matters because the two are 8:1 --
          "70% spent" reads very differently if it is mostly reveals. */}
      <div className="mt-3">
        <div className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-sky-500" style={{ width: `${emailPct}%` }} title="Emails" />
          <div className="h-full bg-violet-500" style={{ width: `${phonePct}%` }} title="Phone reveals" />
          {/* The threshold tick sits ON the bar so it reads as a position
              rather than a separate legend item. */}
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/50"
            style={{ left: `${Math.min(99.5, d.phoneStopPct)}%` }}
            title={`Phone reveals pause at ${d.phoneStopPct}%`}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-500" />
            {d.emailCredits.toLocaleString()} on {d.emailCalls.toLocaleString()} emails
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-violet-500" />
            {d.phoneCredits.toLocaleString()} on {d.phoneCalls.toLocaleString()} phone reveals
          </span>
          <span>{Math.round(pct)}% of budget</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Automatic" value={d.sweepCredits} sub={`cap ${d.sweepCap.toLocaleString()}`} />
        <Stat label="By hand" value={d.manualCredits} sub="people clicking Enrich" />
        <Stat
          label="Fit overrides"
          value={d.overrideCount}
          sub={`${d.overrideCredits.toLocaleString()} credits`}
          alert={d.overrideCount > 0}
        />
        <Stat label="Phone reveals" value={d.phoneCalls} sub={phonesPaused ? "paused" : "available"} alert={phonesPaused} />
      </div>

      {phonesPaused && d.enabled && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <IconPhoneOff size={13} className="shrink-0" />
          {overBar
            ? `All enrichment is paused until ${d.resetLabel}.`
            : `Phone reveals are paused past ${d.phoneStopPct}%. Email enrichment still works.`}
        </p>
      )}

      {/* topSpenders is present only for admins (omitted server-side), so it
          doubles as the admin gate for the ledger export beside it. */}
      {d.topSpenders && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-[180px] flex-1">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Top spenders this period
            </p>
            {d.topSpenders.length === 0 ? (
              <p className="text-xs text-muted-foreground">No credits spent yet.</p>
            ) : (
              <ul className="space-y-1">
                {d.topSpenders.slice(0, 5).map((s) => (
                  <li key={s.actorEmail} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-foreground">{s.actorEmail}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {s.credits.toLocaleString()} · {s.calls} calls
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <LedgerExportButton periodStart={d.periodStart} />
        </div>
      )}
    </div>
  );
}

/**
 * Downloads the credit ledger for a period.
 *
 * This is the artifact the credit pilot runs on: several Apollo billing
 * behaviours cannot be determined from the API (whether a no-match still
 * bills, whether a combined match+reveal is 9 or 8), so the only way to
 * resolve them is to export a period and compare the total against Apollo's
 * real balance. `reprice-apollo-credit-ledger` then applies the correction.
 */
function LedgerExportButton({ periodStart }: { periodStart: string }) {
  const exportLedger = useActionMutation("list-apollo-credit-ledger");
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    try {
      const result = (await exportLedger.mutateAsync({ periodStart })) as {
        rows?: Record<string, unknown>[];
        truncated?: boolean;
      };
      const rows = result.rows ?? [];
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
      if (result.truncated) {
        setError("Hit the row cap — this export is partial.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export the ledger.");
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleExport}
        disabled={exportLedger.isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        <IconDownload size={13} />
        {exportLedger.isPending ? "Exporting…" : "Export ledger"}
      </button>
      <p className="max-w-[180px] text-right text-[10px] leading-3 text-muted-foreground">
        Every charged call, for reconciling against an Apollo invoice.
      </p>
      {error && <p className="max-w-[180px] text-right text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${alert ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
        {value.toLocaleString()}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
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
