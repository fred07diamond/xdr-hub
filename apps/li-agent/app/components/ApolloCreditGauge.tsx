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

/**
 * What the spend columns mean.
 *
 * Lives in the help disclosure rather than as small print under the table:
 * every definition on this card is in one place, and the card itself carries
 * no explanatory paragraphs.
 */
const CREDIT_TERMS: Array<{ term: string; meaning: string }> = [
  {
    term: "Got data",
    meaning: "Credits that bought a real email address or phone number.",
  },
  {
    term: "Low fit",
    meaning:
      "Credits that bought real data for a lead the ICP scored weak, or spent by overriding the fit gate. The money was spent on the wrong person.",
  },
  {
    term: "Wasted",
    meaning:
      "Credits charged where nothing usable came back. Only a timed-out reveal lands here, so this should stay near zero — an empty lookup is free.",
  },
];

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
            {d.enabled
              ? `Resets ${d.resetLabel} · 1 per email, 8 per phone`
              : "Enrichment is turned off — no credits are being spent."}
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
        {/* The leading figure is CREDITS and says so. Dropping the word to
            save space is what produced the original unreadable "8 on 8
            emails", where the same 8 meant credits on one side and records on
            the other -- so the unit stays, twice, and is cut everywhere else
            on the card instead. */}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="mb-px h-2 w-2 shrink-0 self-center rounded-full bg-sky-500" />
            <span className="text-muted-foreground">
              <b className="font-semibold tabular-nums text-foreground">{d.emailCredits.toLocaleString()}</b>{" "}
              {d.emailCredits === 1 ? "credit" : "credits"} on {d.emailCalls.toLocaleString()}{" "}
              {d.emailCalls === 1 ? "email" : "emails"}
            </span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="mb-px h-2 w-2 shrink-0 self-center rounded-full bg-violet-500" />
            <span className="text-muted-foreground">
              <b className="font-semibold tabular-nums text-foreground">{d.phoneCredits.toLocaleString()}</b>{" "}
              {d.phoneCredits === 1 ? "credit" : "credits"} on {d.phoneCalls.toLocaleString()} phone{" "}
              {d.phoneCalls === 1 ? "reveal" : "reveals"}
            </span>
          </span>
          <span className="ml-auto text-muted-foreground">{Math.round(pct)}% used</span>
        </div>
      </div>

      {/* An inset panel rather than four free-standing tiles.
          Two reasons, both structural:
          - It groups "where the money went" into one visual object instead of
            leaving it as four siblings competing with the header.
          - The tiles implied the four figures SUM to the total. They do not:
            by-hand plus automatic is the total, while low-fit and wasted are
            subsets of it. "Of that" makes the nesting readable. */}
      <dl className="mt-4 space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="w-[52px] shrink-0 text-muted-foreground">Credits</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
            <b className="font-semibold tabular-nums text-foreground">{d.manualCredits.toLocaleString()}</b>
            by hand
            <span className="text-muted-foreground/50">·</span>
            <b className="font-semibold tabular-nums text-foreground">{d.sweepCredits.toLocaleString()}</b>
            automatically
            <span className="text-[11px] text-muted-foreground/70">
              (sweep cap {d.sweepCap.toLocaleString()})
            </span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="w-[52px] shrink-0 text-muted-foreground">Of those</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5 text-muted-foreground">
            <b
              className={`font-semibold tabular-nums ${d.lowFitCredits > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
            >
              {d.lowFitCredits.toLocaleString()}
            </b>
            on low-fit leads
            {d.overrideCount > 0 && (
              <span className="text-[11px] text-muted-foreground/70">
                ({d.overrideCount} {d.overrideCount === 1 ? "override" : "overrides"})
              </span>
            )}
            <span className="text-muted-foreground/50">·</span>
            <b
              className={`font-semibold tabular-nums ${d.wastedCredits > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {d.wastedCredits.toLocaleString()}
            </b>
            wasted
          </dd>
        </div>
        {/* Free outcomes belong in this panel rather than as a loose paragraph:
            the worry on seeing a column of "No email on file" is that each one
            cost a credit, and this is where someone looks to check. */}
        {d.emptyCalls > 0 && (
          <div className="flex flex-wrap items-baseline gap-x-2 border-t border-border/60 pt-1.5">
            <dt className="w-[52px] shrink-0 text-muted-foreground">Free</dt>
            <dd className="text-muted-foreground">
              <b className="font-semibold tabular-nums text-foreground">{d.emptyCalls.toLocaleString()}</b>{" "}
              {d.emptyCalls === 1 ? "lookup" : "lookups"} came back empty — Apollo only charges when it has the
              data
            </dd>
          </div>
        )}
      </dl>

      {phonesPaused && d.enabled && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <IconPhoneOff size={13} className="shrink-0" />
          {overBar
            ? `All enrichment is paused until ${d.resetLabel}.`
            : `Phone reveals are paused past ${d.phoneStopPct}%. Email enrichment still works.`}
        </p>
      )}

      {/* Per-person spend, then the help disclosure as a quiet footer.
          Help text belongs AFTER the data it explains, not between the summary
          and the table. */}
      {d.topSpenders && (
        <div className="mt-4 border-t border-border pt-3">
          {/* Title and export on ONE aligned row. Previously the button sat in
              a flex row beside the table, which pushed the table into a narrow
              column and left the button floating against nothing. */}
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Spend by person <span className="font-normal normal-case tracking-normal">(credits)</span>
            </h4>
            <LedgerExportButton periodStart={d.periodStart} />
          </div>

          {d.topSpenders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No credits spent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* A table rather than "16 · 14 calls", which gave two unlabeled
                  numbers and no answer to the actual question: how much of what
                  this person spent was worth spending. Column meanings live in
                  header tooltips and the footer disclosure, not in a paragraph
                  of small print under the table. */}
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-medium">Person</th>
                    <th className="pb-1.5 pl-3 text-right font-medium">Spent</th>
                    <th
                      className="pb-1.5 pl-3 text-right font-medium"
                      title="Credits that bought a real email or phone number"
                    >
                      Got data
                    </th>
                    <th
                      className="pb-1.5 pl-3 text-right font-medium"
                      title="Credits spent on a lead the ICP scored weak, or by overriding the fit gate"
                    >
                      Low fit
                    </th>
                    <th
                      className="pb-1.5 pl-3 text-right font-medium"
                      title="Credits charged where nothing usable came back"
                    >
                      Wasted
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.topSpenders.slice(0, 6).map((s) => (
                    <tr key={s.actorEmail} className="border-t border-border/50">
                      <td className="py-1.5 pr-3">
                        <span className="block max-w-[180px] truncate text-foreground" title={s.actorEmail}>
                          {s.actorEmail.split("@")[0]}
                        </span>
                      </td>
                      <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-foreground">
                        {s.credits.toLocaleString()}
                      </td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                        {s.delivered.toLocaleString()}
                      </td>
                      <td
                        className={`py-1.5 pl-3 text-right tabular-nums ${s.lowFit > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                      >
                        {s.lowFit.toLocaleString()}
                      </td>
                      <td
                        className={`py-1.5 pl-3 text-right tabular-nums ${s.wasted > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
                      >
                        {s.wasted.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* One disclosure holding every definition on the card, so the card
          itself carries no explanatory paragraphs. Generated from the same
          module the table cells read, so it cannot describe states the tables
          no longer show. */}
      <details className="mt-3 border-t border-border pt-2.5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <IconHelpCircle size={13} className="shrink-0" />
          What these states mean, and which ones cost credits
        </summary>

        <div className="mt-2.5 space-y-3">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2.5 py-1.5 font-medium">Email / phone state</th>
                  <th className="px-2.5 py-1.5 font-medium">What it means</th>
                  <th className="px-2.5 py-1.5 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {ENRICHMENT_LEGEND.map((row) => (
                  <tr key={row.label} className="border-b border-border/50 align-top last:border-0">
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

          {/* The column definitions the table footnote used to carry. */}
          <dl className="space-y-1 text-xs">
            {CREDIT_TERMS.map((t) => (
              <div key={t.term} className="flex flex-wrap gap-x-2">
                <dt className="w-[70px] shrink-0 font-medium text-foreground">{t.term}</dt>
                <dd className="flex-1 text-muted-foreground">{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      </details>

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
