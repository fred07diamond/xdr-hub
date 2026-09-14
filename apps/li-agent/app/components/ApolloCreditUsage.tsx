import { IconCheck, IconPhoneOff, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { ENRICHMENT_LEGEND } from "@/lib/enrichment-vocabulary";

import { LedgerExportButton, useCreditUsage, type CreditUsage } from "./ApolloCreditGauge";

/**
 * The full credit usage screen, structured after Apollo's own.
 *
 * Borrowed from Apollo because it answers the right questions in the right
 * order:
 *
 * - **Available leads, and is itself a slice of the donut.** Apollo shows
 *   "78,824 / 83,990 available" rather than "5,166 spent". The question people
 *   arrive with is "can I spend?", not "what have we burned?" -- and making
 *   Available a segment means the ring is whole and the list sums to the
 *   budget instead of to some partial total.
 * - **Breakdown and per-person are separate tabs.** Two different questions;
 *   cramming both into one card is what made the previous version cluttered.
 * - **Team budget and your own cap are distinct panels.** They are different
 *   ceilings and either can stop you.
 *
 * Adapted rather than copied, because our situation differs in three ways:
 *
 * 1. We bill only two features to Apollo's five, but ours are 8:1, so the
 *    composition matters more than the count. Hence credits everywhere and
 *    call counts as secondary detail.
 * 2. Our budget is SELF-IMPOSED -- one third of the account, since two other
 *    tools draw on the same pool. The rail says so, because "27,996" is
 *    otherwise a number with no provenance.
 * 3. We know something Apollo cannot: whether the spend was WORTH it. Apollo
 *    has no concept of lead fit, so the Quality tab has no counterpart there
 *    and is the whole reason this app tracks spend at all.
 */

/**
 * What the spend columns mean.
 *
 * Rendered on the Quality tab beside the field-state legend, so both kinds of
 * definition -- what a cell says, and what a spend column counts -- sit
 * together rather than as small print under a table.
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

const COLORS = {
  available: "#d6d3d1",
  phone: "#4f8b8b",
  email: "#1e3a5f",
  sweep: "#c2703d",
  manual: "#3f7a6a",
} as const;

type Segment = { key: string; label: string; credits: number; color: string; sub?: string };

export function CreditUsageView() {
  const { data, isLoading } = useCreditUsage();
  const d = data as CreditUsage | undefined;
  const [tab, setTab] = useState<"breakdown" | "people" | "quality">("breakdown");

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading credit usage…</p>;
  }
  if (!d) return null;

  return (
    // Summary ACROSS THE TOP, not in a side rail.
    //
    // Apollo can afford a 300px right rail because it has ~1500px to play
    // with. This page is max-w-4xl (848px of content), so a rail left the
    // tabbed area ~490px -- and a table inside that wrapped to one word per
    // line. Moving the three summary panels into a row gives the tab content
    // the full width, which is what the tables and charts actually need.
    <div className="space-y-4">
      <SummaryPanels d={d} />

      <div className="min-w-0 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex gap-1">
            <Tab active={tab === "breakdown"} onClick={() => setTab("breakdown")}>
              Breakdown
            </Tab>
            <Tab active={tab === "people"} onClick={() => setTab("people")}>
              By person
            </Tab>
            <Tab active={tab === "quality"} onClick={() => setTab("quality")}>
              Quality
            </Tab>
          </div>
          {/* No caption beside the button any more -- it was two lines of grey
              text wedged into the tab row, fighting the tabs for the same
              horizontal space. It is the button's tooltip instead. */}
          {d.topSpenders && (
            <div className="shrink-0 py-2">
              <LedgerExportButton periodStart={d.periodStart} />
            </div>
          )}
        </div>

        <div className="p-4">
          {tab === "breakdown" && <BreakdownTab d={d} />}
          {tab === "people" && <PeopleTab d={d} />}
          {tab === "quality" && <QualityTab d={d} />}
        </div>
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 pb-2 text-sm transition-colors ${
        active
          ? "border-primary font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ── Breakdown: donut + list, with a feature/trigger toggle ──────────────

function BreakdownTab({ d }: { d: CreditUsage }) {
  // Apollo's own Features|Action toggle, mapped onto the two splits we have.
  // "How" is the more actionable one for us: automatic spend is policy, spend
  // by hand is behaviour, and they need different responses.
  const [mode, setMode] = useState<"what" | "how">("what");

  const segments: Segment[] = useMemo(() => {
    if (mode === "what") {
      return [
        { key: "available", label: "Available", credits: d.remaining, color: COLORS.available },
        {
          key: "phone",
          label: "Phone reveals",
          credits: d.phoneCredits,
          color: COLORS.phone,
          sub: `${d.phoneCalls.toLocaleString()} ${d.phoneCalls === 1 ? "number" : "numbers"} · 8 credits each`,
        },
        {
          key: "email",
          label: "Emails",
          credits: d.emailCredits,
          color: COLORS.email,
          sub: `${d.emailCalls.toLocaleString()} ${d.emailCalls === 1 ? "address" : "addresses"} · 1 credit each`,
        },
      ];
    }
    return [
      { key: "available", label: "Available", credits: d.remaining, color: COLORS.available },
      {
        key: "manual",
        label: "Spent by hand",
        credits: d.manualCredits,
        color: COLORS.manual,
        sub: "someone clicked Enrich or Reveal",
      },
      {
        key: "sweep",
        label: "Spent automatically",
        credits: d.sweepCredits,
        color: COLORS.sweep,
        sub: `background pipeline · capped at ${d.sweepCap.toLocaleString()}`,
      },
    ];
  }, [mode, d]);

  return (
    <div className="grid items-center gap-5 sm:grid-cols-[176px_minmax(0,1fr)]">
      <Donut segments={segments} spent={d.spent} budget={d.budget} />

      <div className="min-w-0 space-y-2">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <ToggleBtn active={mode === "what"} onClick={() => setMode("what")}>
            What we bought
          </ToggleBtn>
          <ToggleBtn active={mode === "how"} onClick={() => setMode("how")}>
            How it was spent
          </ToggleBtn>
        </div>

        <ul className="space-y-1.5">
          {segments.map((s) => (
            <li
              key={s.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{s.label}</span>
                  {s.sub && <span className="block text-[11px] text-muted-foreground">{s.sub}</span>}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-foreground">
                {s.credits.toLocaleString()}
                <span className="text-muted-foreground"> credits</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[6px] px-2.5 py-1 transition-colors ${
        active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Hand-rolled SVG donut rather than a recharts Pie.
 *
 * The centre label is the whole point of this chart ("232 of 27,996 credits
 * used"), and recharts needs a custom label renderer for that anyway. Doing it
 * with stroke-dasharray is fewer moving parts, renders identically at any size,
 * and avoids a chart library in a component that shows at most four segments.
 */
function Donut({ segments, spent, budget }: { segments: Segment[]; spent: number; budget: number }) {
  const total = segments.reduce((sum, s) => sum + s.credits, 0) || 1;
  const R = 62;
  const CIRC = 2 * Math.PI * R;
  const pct = budget > 0 ? (spent / budget) * 100 : 0;

  const spending = segments.filter((s) => s.key !== "available" && s.credits > 0);

  /**
   * Every non-zero segment gets a visible minimum arc.
   *
   * Apollo's donut works because they are at ~6% used. We are routinely at a
   * fraction of one percent -- 16 credits of 27,996 is 0.2 of a pixel of
   * stroke, so a truthfully-scaled ring is indistinguishable from an empty
   * one, and the chart silently shows nothing at exactly the moment someone
   * is checking whether anything was spent.
   *
   * Tiny slices are therefore drawn at a floor of 2% of the circumference.
   * Defensible here specifically because the exact credit figure for every
   * segment sits immediately to the right, so the ring is a locator, not the
   * source of the number. Above the floor, proportions are exact.
   */
  const MIN_FRAC = 0.02;
  let offset = 0;
  const arcs = spending.map((s) => {
    const frac = Math.max(MIN_FRAC, s.credits / total);
    const arc = { ...s, dash: frac * CIRC, offset };
    offset += frac * CIRC;
    return arc;
  });

  return (
    <div className="relative mx-auto h-[160px] w-[160px] shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        {/* The full ring is painted first and the spent arcs drawn over it, so
            zero spend reads as an untouched budget rather than a broken
            chart. */}
        <circle cx="80" cy="80" r={R} fill="none" stroke={COLORS.available} strokeWidth="18" />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth="18"
            strokeDasharray={`${a.dash} ${CIRC - a.dash}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
        <p className="text-xl font-semibold leading-tight tabular-nums text-foreground">
          {spent.toLocaleString()}
        </p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {spent === 1 ? "credit" : "credits"} used
        </p>
        <p className="mt-0.5 text-[10px] leading-3 text-muted-foreground/70">
          {/* "0%" for a real 16-credit spend looks like a bug, so anything
              non-zero rounds up to "<1%" instead of down to nothing. */}
          {spent === 0 ? "none yet" : pct < 1 ? "<1% of budget" : `${Math.round(pct)}% of budget`}
        </p>
      </div>
    </div>
  );
}

// ── By person: stacked bars or a table ──────────────────────────────────

function PeopleTab({ d }: { d: CreditUsage }) {
  const [view, setView] = useState<"bars" | "table">("bars");
  const [query, setQuery] = useState("");

  const rows = d.topSpenders ?? [];
  const filtered = query.trim()
    ? rows.filter((r) => r.actorEmail.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  if (!d.topSpenders) {
    // Non-admins get their own figures in the rail instead; showing the team's
    // spend to everyone is a decision nobody asked for.
    return (
      <p className="text-sm text-muted-foreground">
        Per-person spend is visible to workspace admins. Your own usage is in the panel on the right.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No credits spent by anyone this period.</p>;
  }

  // Scale bars to the biggest spender, not to the budget: at 200 credits out
  // of 27,996 every bar would otherwise be an invisible sliver.
  const max = Math.max(...rows.map((r) => r.credits), 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {rows.length > 5 && (
          <div className="relative min-w-[180px] flex-1">
            <IconSearch
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teammate"
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          <ToggleBtn active={view === "bars"} onClick={() => setView("bars")}>
            Chart
          </ToggleBtn>
          <ToggleBtn active={view === "table"} onClick={() => setView("table")}>
            Table
          </ToggleBtn>
        </div>
      </div>

      {view === "bars" ? (
        <>
          <div className="space-y-2">
            {filtered.map((r) => (
              <div key={r.actorEmail} className="flex items-center gap-3">
                <span
                  className="w-[110px] shrink-0 truncate text-right text-xs text-muted-foreground"
                  title={r.actorEmail}
                >
                  {r.actorEmail.split("@")[0]}
                </span>
                {/* Stacked, so the composition is visible: the same total can
                    be 8 emails or one phone reveal, and those are different
                    behaviours worth telling apart at a glance.
                    The total sits OUTSIDE this track -- the segment widths are
                    percentages of their container, so a label sharing it would
                    push the longest bar past 100%. */}
                <span className="flex h-5 min-w-0 flex-1 items-center gap-px">
                  <span
                    className="h-full rounded-l-sm"
                    style={{
                      width: `${(r.phoneCredits / max) * 100}%`,
                      backgroundColor: COLORS.phone,
                    }}
                    title={`${r.phoneCredits} credits on phone reveals`}
                  />
                  <span
                    className="h-full"
                    style={{
                      width: `${(r.emailCredits / max) * 100}%`,
                      backgroundColor: COLORS.email,
                    }}
                    title={`${r.emailCredits} credits on emails`}
                  />
                </span>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-foreground">
                  {r.credits.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[122px] text-[11px] text-muted-foreground">
            <LegendDot color={COLORS.phone} label="Phone reveals" />
            <LegendDot color={COLORS.email} label="Emails" />
            <span>Bars are scaled to the largest spender, not to the budget.</span>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-1.5 pr-3 font-medium">Person</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Credits</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Emails</th>
                <th className="pb-1.5 pl-3 text-right font-medium">Phones</th>
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
              {filtered.map((r) => (
                <tr key={r.actorEmail} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="block max-w-[180px] truncate text-foreground" title={r.actorEmail}>
                      {r.actorEmail.split("@")[0]}
                    </span>
                  </td>
                  <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-foreground">
                    {r.credits.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {r.emailCredits.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {r.phoneCredits.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-muted-foreground">
                    {r.delivered.toLocaleString()}
                  </td>
                  <td
                    className={`py-1.5 pl-3 text-right tabular-nums ${r.lowFit > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                  >
                    {r.lowFit.toLocaleString()}
                  </td>
                  <td
                    className={`py-1.5 pl-3 text-right tabular-nums ${r.wasted > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
                  >
                    {r.wasted.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            All figures are credits.{" "}
            <Link to="/settings#apollo-user-limits" className="underline underline-offset-2">
              Set per-person limits
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ── Quality: the tab Apollo has no equivalent for ───────────────────────

function QualityTab({ d }: { d: CreditUsage }) {
  const delivered = Math.max(0, d.spent - d.wastedCredits);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Apollo can tell you what you spent. Only this app knows whether it was worth spending, because only this
        app scored the lead first.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <QualityCard
          label="Got data"
          value={delivered}
          total={d.spent}
          tone="good"
          detail={`${d.emptyCalls.toLocaleString()} ${d.emptyCalls === 1 ? "lookup" : "lookups"} came back empty and cost nothing`}
        />
        <QualityCard
          label="Low fit"
          value={d.lowFitCredits}
          total={d.spent}
          tone={d.lowFitCredits > 0 ? "warn" : "neutral"}
          detail={
            d.overrideCount > 0
              ? `${d.overrideCount} ${d.overrideCount === 1 ? "person overrode" : "overrides of"} the fit gate`
              : "no one overrode the fit gate"
          }
        />
        <QualityCard
          label="Wasted"
          value={d.wastedCredits}
          total={d.spent}
          tone={d.wastedCredits > 0 ? "bad" : "neutral"}
          detail={
            d.wastedCredits > 0
              ? "reveals that timed out with no answer"
              : "nothing charged without a result"
          }
        />
      </div>

      {/* Both definition blocks now run FULL WIDTH, stacked.
          Side by side they each got ~240px, which turned the three-column
          state table into one word per line and truncated "1 credit for an
          email" mid-phrase. Stacking costs vertical space, which this tab has,
          and buys legibility, which it did not. */}
      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            What these figures count
          </h4>
          <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-3">
            {CREDIT_TERMS.map((t) => (
              <div key={t.term}>
                <dt className="font-medium text-foreground">{t.term}</dt>
                <dd className="mt-0.5 leading-4 text-muted-foreground">{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            What the Email and Phone cells mean
          </h4>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-[160px] px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Meaning</th>
                  <th className="w-[140px] px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {ENRICHMENT_LEGEND.map((row) => (
                  <tr key={row.label} className="border-b border-border/50 align-top last:border-0">
                    <td className="px-3 py-2 font-medium text-foreground">{row.label}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.meaning}</td>
                    <td
                      className={`px-3 py-2 ${row.cost === "Free" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}
                    >
                      {row.cost}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function QualityCard({
  label,
  value,
  total,
  detail,
  tone,
}: {
  label: string;
  value: number;
  total: number;
  detail: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const valueClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${valueClass}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {total > 0 ? `${pct}% of the ${total.toLocaleString()} spent` : "nothing spent yet"}
      </p>
      <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] leading-4 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

// ── Summary panels ─────────────────────────────────────────────────────

function SummaryPanels({ d }: { d: CreditUsage }) {
  const phonesPaused = d.spentPct >= d.phoneStopPct;
  const atLimit = d.spentPct >= 100;
  const mine = d.mine;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/* Available first, phrased as Apollo phrases it. People arrive asking
          "can I spend?", which is a question about what is left. */}
      <Panel label="Workspace budget">
        <Big
          value={d.remaining}
          suffix={`/ ${d.budget.toLocaleString()} available`}
          tone={atLimit ? "bad" : phonesPaused ? "warn" : "normal"}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Renews <span className="font-medium text-foreground">{d.resetLabel}</span>
        </p>
        {/* Provenance for the budget. Without this, 27,996 looks like what
            Apollo gave us -- it is not; it is the third we agreed to take. */}
        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          li-agent&rsquo;s own share of the account, not the balance. Two other tools use the same pool.
        </p>
      </Panel>

      <Panel label="Your usage">
        {mine ? (
          <>
            <Big
              value={mine.remaining}
              suffix={`/ ${mine.limit.toLocaleString()} available`}
              tone={mine.remaining === 0 ? "bad" : "normal"}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {mine.credits > 0 ? (
                <>
                  You have used <span className="font-medium text-foreground">{mine.credits.toLocaleString()}</span>
                  {" "}&mdash; {mine.emailCredits.toLocaleString()} on emails, {mine.phoneCredits.toLocaleString()} on
                  phones
                </>
              ) : (
                "You have not spent anything this period."
              )}
            </p>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              {mine.isDefaultLimit
                ? "The workspace default limit. It caps how much of the shared pool you can use."
                : "A personal limit set for you. It caps how much of the shared pool you can use."}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Sign in to see your own allowance.</p>
        )}
      </Panel>

      {/* Tiered degradation has no Apollo equivalent and is the thing most
          likely to surprise someone mid-task, so it gets equal billing. */}
      <Panel label="Phone reveals">
        <p className="mt-0.5 flex items-center gap-1.5 text-xl font-semibold">
          {phonesPaused ? (
            <>
              <IconPhoneOff size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="text-amber-600 dark:text-amber-400">Paused</span>
            </>
          ) : (
            <>
              <IconCheck size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-600 dark:text-emerald-400">Available</span>
            </>
          )}
        </p>
        <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
          {atLimit
            ? `All enrichment is paused until ${d.resetLabel}.`
            : phonesPaused
              ? `Past ${d.phoneStopPct}% of the budget, reveals stop so the rest goes on emails. Resumes ${d.resetLabel}.`
              : `8 credits each. They pause automatically at ${d.phoneStopPct}% of the budget, or ${d.phoneStopAt.toLocaleString()} credits.`}
        </p>
        {!d.enabled && (
          <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
            Enrichment is off workspace-wide.{" "}
            <Link to="/settings#apollo-credits" className="underline underline-offset-2">
              Turn it on
            </Link>
          </p>
        )}
      </Panel>
    </div>
  );
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Big({
  value,
  suffix,
  tone,
}: {
  value: number;
  suffix: string;
  tone: "normal" | "warn" | "bad";
}) {
  const cls =
    tone === "bad"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
      <span className={`text-2xl font-semibold tabular-nums ${cls}`}>{value.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </p>
  );
}
