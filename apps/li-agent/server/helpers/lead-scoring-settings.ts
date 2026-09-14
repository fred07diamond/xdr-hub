import { inArray } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { workspaceSettings } from "../db/schema.js";

/**
 * Tuning for the highlighted-leads section.
 *
 * Kept OUT of the apollo_* credit settings deliberately: those govern spend
 * and are read on every authorization, while these govern presentation. Mixing
 * them would mean a UI preference change touches the same row set the credit
 * guard reads on every Apollo call.
 */
export const HOT_LEAD_SETTING_KEYS = {
  scoreThreshold: "hot_lead_score_threshold",
  intentWindowDays: "hot_lead_intent_window_days",
} as const;

export interface LeadScoringSettings {
  scoreThreshold: number;
  intentWindowDays: number;
}

export const LEAD_SCORING_DEFAULTS: LeadScoringSettings = {
  scoreThreshold: 85,
  intentWindowDays: 30,
};

function parseInteger(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Never throws on bad data -- a garbage value falls back to its default.
 *
 * Unlike the credit settings, which propagate a DB error so the guard can deny
 * the spend, this one fails SOFT: the worst outcome of a bad read here is a
 * highlighted section that highlights the wrong leads, which is not worth
 * taking a page down for.
 */
export async function getLeadScoringSettings(): Promise<LeadScoringSettings> {
  try {
    const rows = await getDb()
      .select({ key: workspaceSettings.key, value: workspaceSettings.value })
      .from(workspaceSettings)
      .where(inArray(workspaceSettings.key, Object.values(HOT_LEAD_SETTING_KEYS)));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      // Floor of 1: a threshold of 0 would make every scored lead hot, which
      // is indistinguishable from the feature being broken.
      scoreThreshold: parseInteger(
        map.get(HOT_LEAD_SETTING_KEYS.scoreThreshold),
        LEAD_SCORING_DEFAULTS.scoreThreshold,
        1,
        100,
      ),
      intentWindowDays: parseInteger(
        map.get(HOT_LEAD_SETTING_KEYS.intentWindowDays),
        LEAD_SCORING_DEFAULTS.intentWindowDays,
        1,
        365,
      ),
    };
  } catch {
    return { ...LEAD_SCORING_DEFAULTS };
  }
}
