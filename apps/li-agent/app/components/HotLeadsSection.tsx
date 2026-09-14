import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconChevronDown,
  IconChevronRight,
  IconFlame,
  IconLoader2,
  IconSparkles,
} from "@tabler/icons-react";
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
  /**
   * Scores or rescores one lead. Without this the cards told people to
   * "rescore for a detailed score" and offered no way to do it.
   */
  onScore?: (lead: T) => Promise<void>;
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
  onScore,
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
  const [scoringIds, setScoringIds] = useState<Set<string>>(new Set());
  const [scoringAll, setScoringAll] = useState<{ done: number; total: number } | null>(null);
  // Surfaced rather than swallowed. draftProfile catches its own failures and
  // writes fitReason "Draft failed: ...", so a broken score wrote a row and
  // returned normally -- the button appeared to do nothing at all.
  const [scoreError, setScoreError] = useState<string | null>(null);

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

  async function scoreOne(lead: T) {
    if (!onScore) return;
    setScoreError(null);
    setScoringIds((prev) => new Set(prev).add(lead.id));
    try {
      await onScore(lead);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Could not score that lead.");
    } finally {
      setScoringIds((prev) => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  }

  async function scoreAllEstimated(targets: T[]) {
    if (!onScore || targets.length === 0) return;
    setScoringAll({ done: 0, total: targets.length });
    try {
      // Sequential, matching every other scoring loop in the app: each is an
      // LLM call against a per-owner rate bucket, and firing 19 at once just
      // converts them into rate-limit errors.
      let failures = 0;
      let lastMessage = "";
      for (const lead of targets) {
        await onScore(lead).catch((err: unknown) => {
          failures += 1;
          lastMessage = err instanceof Error ? err.message : "";
        });
        setScoringAll((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
      // Reported once at the end rather than per lead. A run of 19 that failed
      // silently looked like the button did nothing.
      if (failures > 0) {
        setScoreError(
          `${failures} of ${targets.length} could not be scored.${lastMessage ? ` ${lastMessage}` : ""}`,
        );
      }
    } finally {
      setScoringAll(null);
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

  const shown = showAll ? hot : hot.slice(0, MAX_SHOWN);
  const estimatedLeads = hot.filter((l) => typeof l.fitScore !== "number");

  return (
    // Neutral surface with ONE amber accent (the flame and a hairline top
    // border), rather than an amber gradient behind amber-bordered cards
    // holding amber chips. Six of those stacked is a wall of yellow, and the
    // colour stops meaning "notable" once everything on screen has it.
    <section className={`border-b border-border bg-muted/30 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 text-left"
        >
          {collapsed ? (
            <IconChevronRight size={14} className="shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronDown size={14} className="shrink-0 text-muted-foreground" />
          )}
          <IconFlame size={15} className="shrink-0 text-amber-500" />
          <span className="text-sm font-semibold text-foreground">
            Hot leads
            <span className="ms-1.5 font-normal text-muted-foreground">
              {hot.length}
              {scopeLabel ? ` ${scopeLabel}` : ""}
            </span>
          </span>
        </button>

        {/* The instruction the cards used to carry, said ONCE, and now next to
            the button that acts on it. */}
        {onScore && estimatedLeads.length > 0 && (
          <button
            type="button"
            onClick={() => void scoreAllEstimated(estimatedLeads)}
            disabled={!!scoringAll}
            className="ms-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {scoringAll ? (
              <>
                <IconLoader2 size={12} className="animate-spin" />
                Scoring {scoringAll.done}/{scoringAll.total}…
              </>
            ) : (
              <>
                <IconSparkles size={12} />
                Score {estimatedLeads.length} for detail
              </>
            )}
          </button>
        )}
        <span
          className={`text-[11px] text-muted-foreground ${onScore && estimatedLeads.length > 0 ? "" : "ms-auto"}`}
        >
          {estimatedLeads.length === hot.length
            ? "Strong fit in a matched persona"
            : `${settings.scoreThreshold}+ score, or strong fit in a matched persona`}
        </span>
      </div>

      {scoreError && (
        <p className="mx-4 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {scoreError}
        </p>
      )}

      {!collapsed && (
        <div className="px-4 pb-3">
          {/* Two columns once there is room. Nineteen full-width cards holding
              a name and two buttons was mostly empty space, which made the
              section feel enormous for the amount it said. */}
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((lead) => (
              <HotLeadCard
                key={lead.id}
                lead={lead}
                settings={settings}
                scoring={scoringIds.has(lead.id) || !!scoringAll}
                onGenerate={onGenerate ? () => onGenerate(lead) : undefined}
                onOpen={onOpen ? () => onOpen(lead) : undefined}
                onScore={onScore ? () => void scoreOne(lead) : undefined}
              />
            ))}
          </div>

          {hot.length > MAX_SHOWN && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
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
  scoring,
  onGenerate,
  onOpen,
  onScore,
}: {
  lead: T;
  settings: HotLeadSettings;
  scoring?: boolean;
  onGenerate?: () => void;
  onOpen?: () => void;
  onScore?: () => void;
}) {
  const assessment = assessHotLead(lead, settings);
  const link = lead.profileUrl || lead.salesNavLeadUrl || null;
  const scored = typeof lead.fitScore === "number";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
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
          {scored ? (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {lead.fitScore}
            </span>
          ) : (
            <IconFlame
              size={12}
              className="shrink-0 text-amber-500"
              title="Strong fit in a matched persona"
            />
          )}
        </div>
        {/* Corroborators as a compact chip, not a sentence. The SENTENCE slot
            below belongs to the model's actual reasoning. */}
        {scored && assessment.reasons.length > 0 && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {assessment.reasons.includes("intent") ? "live intent" : "decision-level"}
          </span>
        )}
      </div>

      <p className="truncate text-xs text-muted-foreground">
        {[lead.enrichedTitle || lead.headline, lead.company].filter(Boolean).join(" · ") || "—"}
      </p>

      {/* THE REASONING. This is what the card was missing: fitReason is the
          model's one sentence citing the specific evidence it scored on, and
          the card was showing a generic "decision-level in a matched persona"
          instead — which restates the rule rather than explaining the lead. */}
      {lead.fitReason && (
        <p className="mt-1.5 text-xs leading-5 text-foreground">{lead.fitReason}</p>
      )}
      {lead.intentSignal && (
        <p className="mt-1.5 border-s-2 border-amber-400 ps-2 text-xs italic text-muted-foreground">
          {lead.intentSignal}
        </p>
      )}

      {/* Under the reason rather than beside it. Side by side, the bars
          competed with the sentence for the same eye and squeezed both. */}
      {scored && <ScoreBreakdown lead={lead} className="mt-2" />}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Write outreach
          </button>
        )}
        {onScore && (
          <button
            type="button"
            onClick={onScore}
            disabled={scoring}
            title={
              scored
                ? "Re-score against the current persona criteria"
                : "Score for a detailed 0-100 breakdown"
            }
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {scoring ? <IconLoader2 size={11} className="animate-spin" /> : <IconSparkles size={11} />}
            {scoring ? "Scoring…" : scored ? "Rescore" : "Score"}
          </button>
        )}
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
          >
            LinkedIn
          </a>
        )}
        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={lead.enrichedEmail ? "text-foreground" : ""}>
            {lead.enrichedEmail ? "email" : "no email"}
          </span>
          <span aria-hidden>·</span>
          <span className={lead.enrichedPhone ? "text-foreground" : ""}>
            {lead.enrichedPhone ? "phone" : "no phone"}
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Per-dimension bars for the dimensions that were ACTUALLY assessed.
 *
 * The previous version read `lead.scoreIntent ?? 0`, which collapsed NULL
 * ("no evidence, not judged") into 0 ("judged and scored zero") and then drew
 * an empty "Intent signals 0/25" bar. That is the same "penalised for data we
 * never captured" message the scoring fix removed from the arithmetic, put
 * straight back in visually — and it is worse than the arithmetic version,
 * because the number beside it says the lead lost 25 points it never had a
 * chance at.
 *
 * Nulls are now preserved and unassessed dimensions are omitted, with the
 * denominator stated so an 87 out of three signals is not mistaken for an 87
 * out of four.
 */
export function ScoreBreakdown({
  lead,
  className,
}: {
  lead: HotLead;
  className?: string;
}) {
  // Null stays null. That distinction is the whole point.
  const values: Record<ScoreDimension, number | null> = {
    roleFit: lead.scoreRoleFit ?? null,
    seniority: lead.scoreSeniority ?? null,
    companyFit: lead.scoreCompanyFit ?? null,
    intent: lead.scoreIntent ?? null,
  };

  const assessed = DIMENSION_ORDER.filter((d) => values[d] !== null);
  const missing = DIMENSION_ORDER.filter((d) => values[d] === null);

  // Scored by an older version with no breakdown stored: show the total alone
  // rather than four bars implying every dimension scored zero.
  if (assessed.length === 0) return null;

  const assessedMax = assessed.reduce((sum, d) => sum + SCORE_WEIGHTS[d], 0);
  const earned = assessed.reduce((sum, d) => sum + (values[d] ?? 0), 0);

  return (
    <div className={className}>
      <dl className="space-y-1">
        {assessed.map((d) => {
          const max = SCORE_WEIGHTS[d];
          const value = Math.min(max, values[d] ?? 0);
          const pct = max > 0 ? (value / max) * 100 : 0;
          return (
            <div key={d} className="flex items-center gap-2">
              <dt className="w-[76px] shrink-0 text-[10px] text-muted-foreground">{DIMENSION_LABELS[d]}</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-muted-foreground/40"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-end text-[10px] tabular-nums text-muted-foreground">
                  {value}/{max}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      {/* States the denominator, and names what could not be judged and why.
          "Not assessed" is a fact about our data, not a mark against the
          lead. */}
      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
        {earned}/{assessedMax} across {assessed.length} of {DIMENSION_ORDER.length} signals
        {missing.length > 0 && (
          <>
            {" · "}
            <span title={MISSING_HINT}>
              {missing.map((d) => DIMENSION_LABELS[d]).join(", ")} not assessed
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Why a dimension can be unassessable, said once.
 *
 * Intent is the usual one and it is worth being straight about: nothing in the
 * app supplies activity data for a Sales Nav lead list. `recentActivity` is
 * only ever populated by capture-profile, from the extension reading a real
 * profile page, so a lead-list row can never be scored on intent until someone
 * opens that profile.
 */
const MISSING_HINT =
  "Intent needs recent activity, which only exists once the extension has read the person's actual profile page. " +
  "A Sales Navigator list row carries no activity, so intent is excluded from the score rather than counted as zero.";

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
