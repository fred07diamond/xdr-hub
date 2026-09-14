// What makes a lead worth spending Apollo credits on.
//
// Kept as one shared function rather than inline conditions per table, because
// the whole point is that both tables, the bulk-selection default, and the
// batch-cap truncation all agree on which leads are the good ones. If they
// disagreed, "we kept your 50 highest-fit leads" would not be true.

export type LeadQuality = "stellar" | "good" | "ok" | "low" | "unscored";

export interface QualityInputs {
  fitVerdict?: string | null;
  personaName?: string | null;
  /** 1 = thumbs up, -1 = thumbs down, null = unrated. Prospects only. */
  rating?: number | null;
}

/**
 * `stellar` requires TWO independent signals agreeing, or a human overriding.
 *
 * A `strong` verdict alone is one LLM judgment. `strong` PLUS a matched
 * persona means two separate passes concurred -- persona is assigned at import
 * time by selectPersonasBatch from the headline alone, before any scoring
 * happens, and an unparseable or no-match pick yields null. So the two are
 * genuinely independent rather than the same call read twice.
 *
 * A human thumbs-up outranks everything: if someone looked at the lead and
 * said yes, the model does not get to demote it.
 *
 * `inconclusive` maps to `unscored`, never `low`. It means "no ICP document
 * uploaded", not "bad lead" -- treating it as low quality would hide every
 * lead in a workspace that has not uploaded criteria yet.
 */
export function leadQuality(row: QualityInputs): LeadQuality {
  if (row.rating === 1) return "stellar";
  if (row.fitVerdict === "strong" && row.personaName) return "stellar";
  if (row.fitVerdict === "strong") return "good";
  if (row.fitVerdict === "possible") return "ok";
  if (row.fitVerdict === "weak") return "low";
  return "unscored";
}

/** Sort order for "stellar first". Lower sorts earlier. */
const QUALITY_RANK: Record<LeadQuality, number> = {
  stellar: 0,
  good: 1,
  ok: 2,
  unscored: 3,
  low: 4,
};

export function qualityRank(row: QualityInputs): number {
  return QUALITY_RANK[leadQuality(row)];
}

/**
 * Sorts best-first. Used when a bulk action has to be truncated to the batch
 * cap: if the cap is going to discard most of a selection, the ones that
 * survive should be the best ones, not whichever happen to sit at the top of
 * the Sales Nav order. That is what makes the cap a steering mechanism rather
 * than an arbitrary limit.
 */
export function sortByQuality<T extends QualityInputs>(rows: T[]): T[] {
  return [...rows].sort((a, b) => qualityRank(a) - qualityRank(b));
}

/** True for leads worth putting in front of the user first. */
export function isHighValue(row: QualityInputs): boolean {
  const q = leadQuality(row);
  return q === "stellar" || q === "good";
}

/**
 * Whether a lead is worth including in an automatic bulk enrich.
 *
 * Excludes only `low` (an explicit `weak` verdict). `unscored` is deliberately
 * INCLUDED: a lead nobody has scored yet may well be good, and excluding it
 * would mean a freshly imported list had nothing eligible at all.
 */
export function isBulkEligibleQuality(row: QualityInputs): boolean {
  return leadQuality(row) !== "low";
}
