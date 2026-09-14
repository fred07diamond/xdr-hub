import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconAlertTriangle, IconCoins, IconDownload, IconHelpCircle, IconPhoneOff, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ENRICHMENT_LEGEND } from "@/lib/enrichment-vocabulary";
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
  thresholds: number[];
  topSpenders?: {
    actorEmail: string;
    credits: number;
    calls: number;
    delivered: number;
    wasted: number;
    lowFit: number;
    emptyCalls: number;
  }[];
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
        {/* Every number carries its unit. The previous wording ("8 on 8
            emails", "8 on 1 phone reveals") put two different quantities
            side by side with no label, so the same "8" meant credits in one
            place and records in the other. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
            <span className="text-muted-foreground">Emails found</span>
            <span className="font-medium tabular-nums text-foreground">{d.emailCalls.toLocaleString()}</span>
            <span className="text-muted-foreground">
              = {d.emailCredits.toLocaleString()} {d.emailCredits === 1 ? "credit" : "credits"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />
            <span className="text-muted-foreground">Phones revealed</span>
            <span className="font-medium tabular-nums text-foreground">{d.phoneCalls.toLocaleString()}</span>
            <span className="text-muted-foreground">
              = {d.phoneCredits.toLocaleString()} {d.phoneCredits === 1 ? "credit" : "credits"}
            </span>
          </span>
          <span className="text-muted-foreground">{Math.round(pct)}% of budget used</span>
        </div>

        {/* The lookups that returned nothing. Worth stating explicitly and
            worth stating as FREE, because the obvious worry on seeing a
            column of "No email on file" is that each one cost a credit. */}
        {d.emptyCalls > 0 && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {d.emptyCalls.toLocaleString()} {d.emptyCalls === 1 ? "lookup" : "lookups"} came back empty —
            Apollo had no data for {d.emptyCalls === 1 ? "that person" : "those people"}.{" "}
            <span className="font-medium text-foreground">Not charged.</span>
          </p>
        )}
      </div>

      {/* Every tile is credits, so the numbers are comparable. The old row
          mixed credits ("automatic 0") with record counts ("phone reveals 1")
          and a status word ("available") under the same styling. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Spent automatically"
          value={`${d.sweepCredits.toLocaleString()} credits`}
          sub={`of ${d.sweepCap.toLocaleString()} the sweep may use`}
        />
        <Stat
          label="Spent by hand"
          value={`${d.manualCredits.toLocaleString()} credits`}
          sub="someone clicked Enrich or Reveal"
        />
        <Stat
          label="Spent on low-fit leads"
          value={`${d.lowFitCredits.toLocaleString()} credits`}
          sub={
            d.overrideCount > 0
              ? `${d.overrideCount} fit ${d.overrideCount === 1 ? "override" : "overrides"}`
              : "no gate overrides"
          }
          alert={d.lowFitCredits > 0}
        />
        <Stat
          label="Paid for nothing"
          value={`${d.wastedCredits.toLocaleString()} credits`}
          sub={d.wastedCredits > 0 ? "charged, nothing came back" : "nothing wasted"}
          alert={d.wastedCredits > 0}
        />
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Phone reveals are{" "}
        <span className={phonesPaused ? "font-medium text-amber-600 dark:text-amber-400" : "font-medium text-foreground"}>
          {phonesPaused ? "paused" : "available"}
        </span>{" "}
        · 1 credit per email, 8 per phone · Apollo only charges when it actually has the data
      </p>

      {phonesPaused && d.enabled && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <IconPhoneOff size={13} className="shrink-0" />
          {overBar
            ? `All enrichment is paused until ${d.resetLabel}.`
            : `Phone reveals are paused past ${d.phoneStopPct}%. Email enrichment still works.`}
        </p>
      )}

      {/* The vocabulary, generated from the same module the table cells read,
          so the legend cannot describe states the tables no longer show. */}
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <IconHelpCircle size={13} />
          What do the Email and Phone states mean, and which ones cost credits?
        </summary>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2.5 py-1.5 font-medium">State</th>
                <th className="px-2.5 py-1.5 font-medium">What it means</th>
                <th className="px-2.5 py-1.5 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ENRICHMENT_LEGEND.map((row) => (
                <tr key={row.label} className="border-b border-border/50 last:border-0 align-top">
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">{row.label}</td>
                  <td className="px-2.5 py-1.5 text-muted-foreground">{row.meaning}</td>
                  <td
                    className={`whitespace-nowrap px-2.5 py-1.5 ${row.cost === "Free" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}
                  >
                    {row.cost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* topSpenders is present only for admins (omitted server-side), so it
          doubles as the admin gate for the ledger export beside it. */}
      {d.topSpenders && (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-[280px] flex-1">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Spend by person this period
            </p>
            {d.topSpenders.length === 0 ? (
              <p className="text-xs text-muted-foreground">No credits spent yet.</p>
            ) : (
              <div className="overflow-x-auto">
                {/* A table rather than "16 · 14 calls", which gave two
                    unlabeled numbers and no answer to the actual question:
                    how much of what this person spent was worth spending. */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-1 pr-3 font-medium">Person</th>
                      <th className="pb-1 pr-3 text-right font-medium">Spent</th>
                      <th className="pb-1 pr-3 text-right font-medium" title="Credits that bought a real email or phone number">
                        Got data
                      </th>
                      <th className="pb-1 pr-3 text-right font-medium" title="Credits spent on a lead the ICP scored weak, or by overriding the fit gate">
                        Low fit
                      </th>
                      <th className="pb-1 text-right font-medium" title="Credits charged where nothing usable came back">
                        Wasted
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topSpenders.slice(0, 6).map((s) => (
                      <tr key={s.actorEmail} className="border-t border-border/50">
                        <td className="py-1 pr-3">
                          <span className="block max-w-[150px] truncate text-foreground" title={s.actorEmail}>
                            {s.actorEmail.split("@")[0]}
                          </span>
                        </td>
                        <td className="py-1 pr-3 text-right font-medium tabular-nums text-foreground">
                          {s.credits.toLocaleString()}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                          {s.delivered.toLocaleString()}
                        </td>
                        <td
                          className={`py-1 pr-3 text-right tabular-nums ${s.lowFit > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {s.lowFit.toLocaleString()}
                        </td>
                        <td
                          className={`py-1 text-right tabular-nums ${s.wasted > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
                        >
                          {s.wasted.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                  All figures are credits. <span className="text-foreground">Low fit</span> is money that bought real
                  data for someone not worth calling. <span className="text-foreground">Wasted</span> is money charged
                  that returned nothing — an empty lookup is free, so this should stay near zero.
                </p>
              </div>
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
  value: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${alert ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] leading-4 text-muted-foreground">{sub}</p>}
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
