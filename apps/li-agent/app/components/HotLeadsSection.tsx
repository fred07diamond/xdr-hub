import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronDown, IconChevronRight, IconFlame } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import {
  DIMENSION_LABELS,
  DIMENSION_ORDER,
  MAX_FIT_SCORE,
  SCORE_WEIGHTS,
  type ScoreDimension,
} from "@/lib/fit-score-shared";
import {
  assessHotLead,
  describeHotReasons,
  HOT_LEAD_DEFAULTS,
  sortHotLeads,
  type HotLeadSettings,
  type ScorableLead,
} from "@/lib/hot-leads";

/**
 * The highlighted-leads section that sits above a lead table.
 *
 * Its job is not to be another table. It is the place where a lead worth
 * real effort gets the extra surface that effort needs: the score broken out
 * so you can see WHY it is here, the specific signal that made it hot, and
 * the generators that only make sense for someone you have decided to chase.
 *
 * Renders NOTHING when no lead qualifies. An empty "Hot Leads" header is
 * worse than no header: it takes permanent vertical space above the work to
 * report an absence, and it trains people to scroll past the top of the page.
 */

export interface HotLead extends ScorableLead {
  id: string;
  name: string | null;
  company: string | null;
  headline: string | null;
  fitReason?: string | null;
  enrichedTitle?: string | null;
  enrichedEmail?: string | null;
  enrichedPhone?: string | null;
  profileUrl?: string | null;
  salesNavLeadUrl?: string | null;
}

export interface HotLeadsSectionProps<T extends HotLead> {
  leads: T[];
  /** Opens the generator panel for one lead. */
  onGenerate?: (lead: T) => void;
  /** Opens the row's normal detail view. */
  onOpen?: (lead: T) => void;
  /** Label for the surface, e.g. "in this list". */
  scopeLabel?: string;
  /** Hidden entirely when the workspace has no scored leads at all. */
  className?: string;
}

const COLLAPSE_KEY = "li.hotLeads.collapsed";
const MAX_SHOWN = 6;

export function HotLeadsSection<T extends HotLead>({
  leads,
  onGenerate,
  onOpen,
  scopeLabel = "",
  className,
}: HotLeadsSectionProps<T>) {
  const { data } = useActionQuery("get-lead-scoring-settings", {});
  const settings: HotLeadSettings = useMemo(() => {
    const d = data as Partial<HotLeadSettings> | undefined;
    return {
      scoreThreshold: d?.scoreThreshold ?? HOT_LEAD_DEFAULTS.scoreThreshold,
      intentWindowDays: d?.intentWindowDays ?? HOT_LEAD_DEFAULTS.intentWindowDays,
    };
  }, [data]);

  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Blocked storage is not a reason to hide the section.
    }
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // Not persisting is a minor annoyance.
    }
  }

  const hot = useMemo(() => {
    // `now` is captured once per render rather than per lead, so a batch
    // cannot straddle the freshness boundary and show two leads with the same
    // timestamp on opposite sides of it.
    const now = Date.now();
    return sortHotLeads(
      leads.filter((l) => assessHotLead(l, settings, now).hot),
    );
  }, [leads, settings]);

  // Nothing qualifies: render nothing at all rather than an empty header. No
  // "score these first" hint any more -- the legacy stellar fallback means a
  // page of old leads surfaces its best ones without being rescored, so a
  // genuinely empty section means genuinely nothing exceptional, which needs
  // no explanation.
  if (hot.length === 0) return null;

  // How many are running on the legacy signal rather than a real score. Worth
  // stating once in the header: it is the difference between "these are the
  // best three" and "these are the best three we can tell so far".
  const estimated = hot.filter((l) => typeof l.fitScore !== "number").length;

  const shown = showAll ? hot : hot.slice(0, MAX_SHOWN);

  return (
    <section
      className={`border-b border-amber-300/60 bg-gradient-to-b from-amber-50/80 to-transparent dark:border-amber-900/50 dark:from-amber-950/25 ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {collapsed ? (
          <IconChevronRight size={14} className="shrink-0 text-amber-700 dark:text-amber-400" />
        ) : (
          <IconChevronDown size={14} className="shrink-0 text-amber-700 dark:text-amber-400" />
        )}
        <IconFlame size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-semibold text-foreground">
          Hot leads
          <span className="ms-1.5 font-normal text-muted-foreground">
            {hot.length}
            {scopeLabel ? ` ${scopeLabel}` : ""}
          </span>
        </span>
        <span className="ms-auto text-[11px] text-muted-foreground">
          {estimated === hot.length
            ? "Strong fit in a matched persona · rescore for detailed scores"
            : estimated > 0
              ? `${settings.scoreThreshold}+ score, or strong fit in a matched persona`
              : `${settings.scoreThreshold}+ score, with live intent or decision-level authority`}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-2 px-4 pb-3">
          {shown.map((lead) => (
            <HotLeadCard
              key={lead.id}
              lead={lead}
              settings={settings}
              onGenerate={onGenerate ? () => onGenerate(lead) : undefined}
              onOpen={onOpen ? () => onOpen(lead) : undefined}
            />
          ))}

          {hot.length > MAX_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {showAll ? "Show fewer" : `Show all ${hot.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function HotLeadCard<T extends HotLead>({
  lead,
  settings,
  onGenerate,
  onOpen,
}: {
  lead: T;
  settings: HotLeadSettings;
  onGenerate?: () => void;
  onOpen?: () => void;
}) {
  const assessment = assessHotLead(lead, settings);
  const link = lead.profileUrl || lead.salesNavLeadUrl || null;

  return (
    <div className="rounded-lg border border-amber-300/70 bg-card p-3 dark:border-amber-900/50">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                className="truncate text-sm font-semibold text-foreground hover:underline"
              >
                {lead.name ?? "Unnamed lead"}
              </button>
            ) : (
              <span className="truncate text-sm font-semibold text-foreground">
                {lead.name ?? "Unnamed lead"}
              </span>
            )}
            {typeof lead.fitScore === "number" ? (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                {lead.fitScore}
              </span>
            ) : (
              // No number to show. A placeholder "0" or "—" in the same
              // position would read as a score of zero, which is the opposite
              // of what this lead is.
              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Stellar
              </span>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[lead.enrichedTitle || lead.headline, lead.company].filter(Boolean).join(" · ") || "—"}
          </p>

          {/* The specific signal, not a restatement of the score. This is the
              sentence that tells someone what to open with. */}
          {lead.intentSignal && (
            <p className="mt-1.5 border-s-2 border-amber-400 ps-2 text-xs italic text-foreground">
              {lead.intentSignal}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {describeHotReasons(assessment.reasons)}
          </p>
        </div>

        <ScoreBreakdown lead={lead} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Write outreach
          </button>
        )}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Open LinkedIn
          </a>
        )}
        {/* Contact data is stated rather than implied, so it is obvious
            whether an email generator has anything to send to. */}
        <span className="ms-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className={lead.enrichedEmail ? "text-foreground" : ""}>
            {lead.enrichedEmail ? "email ✓" : "no email"}
          </span>
          <span className={lead.enrichedPhone ? "text-foreground" : ""}>
            {lead.enrichedPhone ? "phone ✓" : "no phone"}
          </span>
        </span>
      </div>
    </div>
  );
}

function ScoreBreakdown({ lead }: { lead: HotLead }) {
  const values: Record<ScoreDimension, number> = {
    roleFit: lead.scoreRoleFit ?? 0,
    seniority: lead.scoreSeniority ?? 0,
    companyFit: lead.scoreCompanyFit ?? 0,
    intent: lead.scoreIntent ?? 0,
  };

  // No breakdown stored (scored by an older version) -- show the total alone
  // rather than four empty bars implying every dimension scored zero.
  const hasBreakdown = DIMENSION_ORDER.some((d) => values[d] > 0);
  if (!hasBreakdown) return null;

  return (
    <dl className="w-[190px] shrink-0 space-y-1">
      {DIMENSION_ORDER.map((d) => {
        const max = SCORE_WEIGHTS[d];
        const value = Math.min(max, values[d]);
        const pct = max > 0 ? (value / max) * 100 : 0;
        return (
          <div key={d} className="flex items-center gap-2">
            <dt className="w-[74px] shrink-0 text-[10px] text-muted-foreground">{DIMENSION_LABELS[d]}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-amber-500"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-9 shrink-0 text-end text-[10px] tabular-nums text-muted-foreground">
                {value}/{max}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Small inline score chip for use inside a normal table row. */
export function ScoreChip({
  score,
  reason,
  className,
}: {
  score: number | null | undefined;
  reason?: string | null;
  className?: string;
}) {
  if (typeof score !== "number") return null;
  const tone =
    score >= 85
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : score >= 70
        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : score >= 40
          ? "bg-muted text-muted-foreground"
          : "bg-muted text-muted-foreground/70";
  return (
    <span
      title={reason ? `${score}/${MAX_FIT_SCORE} — ${reason}` : `${score}/${MAX_FIT_SCORE}`}
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone} ${className ?? ""}`}
    >
      {score}
    </span>
  );
}

/** Link to the settings that control this section. */
export function HotLeadsThresholdLink() {
  return (
    <Link to="/settings#lead-scoring" className="text-xs text-muted-foreground underline hover:text-foreground">
      Adjust thresholds
    </Link>
  );
}
