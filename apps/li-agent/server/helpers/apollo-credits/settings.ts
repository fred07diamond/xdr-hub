import { like } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { workspaceSettings } from "../../db/schema.js";
import { clampAnchorDay, DEFAULT_ANCHOR_DAY } from "./period.js";

// Admin-tunable knobs for Apollo credit governance, stored in
// workspace_settings (the same key-value store daily_outreach_limit uses --
// see actions/set-daily-limit.ts for the write path this mirrors).
//
// Read in ONE `key LIKE 'apollo_%'` query rather than a query per key: the
// guard needs most of them on every spend authorization, and one small indexed
// scan beside a 20-second Apollo call is free.
//
// Deliberately NOT cached in v1. A TTL would mean an admin hitting the kill
// switch has to wait for it to expire, and there is no cache-invalidation
// design that is obviously correct across serverless instances. If this ever
// shows up in a profile, a few seconds of TTL is the easy win -- but "the
// switch takes effect instantly" is worth more than the query.

export const APOLLO_SETTING_KEYS = {
  enabled: "apollo_enrichment_enabled",
  periodBudget: "apollo_credit_period_budget",
  anchorDay: "apollo_credit_period_anchor_day",
  safetyMargin: "apollo_credit_safety_margin",
  userDefaultLimit: "apollo_user_default_credit_limit",
  phoneStopPct: "apollo_credit_phone_stop_pct",
  sweepReservePct: "apollo_credit_sweep_reserve_pct",
  thresholds: "apollo_credit_thresholds",
  enrichMinVerdict: "apollo_enrich_min_verdict",
  phoneMinVerdict: "apollo_phone_min_verdict",
} as const;

/**
 * Which fit verdicts clear a spend gate.
 *
 * `not_weak` is the DEFAULT for the 1-credit email gate, and that choice is
 * load-bearing rather than arbitrary. draftProfile returns `inconclusive` with
 * the reason "No ICP document uploaded" whenever a workspace has no ICP text,
 * so a stricter default (`strong_or_possible`) would mean a workspace that has
 * not uploaded an ICP silently enriches NOTHING, forever -- indistinguishable
 * from a broken integration. Treating `inconclusive` as passing for 1 credit
 * (recoverable) while requiring an override for 8 (not recoverable) puts the
 * strictness where the money is.
 */
export type VerdictBar = "strong" | "strong_or_possible" | "not_weak" | "any";

export const VERDICT_BAR_VALUES: readonly VerdictBar[] = [
  "strong",
  "strong_or_possible",
  "not_weak",
  "any",
];

export interface ApolloCreditSettings {
  /** Master switch. Unset means DISABLED -- see parse below. */
  enabled: boolean;
  /** Credits this app may spend per billing period (its share of the account). */
  periodBudget: number;
  /** Day of month the allocation renews. */
  anchorDay: number;
  /** Refuse the last N credits, to absorb concurrent-check overshoot. */
  safetyMargin: number;
  /** Per-user allowance for users with no explicit row. */
  userDefaultLimit: number;
  /** Percent of the budget at which phone reveals (8 credits) stop. */
  phoneStopPct: number;
  /** Percent of the budget the automatic sweep may consume. */
  sweepReservePct: number;
  /** Percentages at which admins get a one-per-period notification. */
  thresholds: number[];
  /** Minimum verdict for the automatic sweep to spend 1 credit on an email. */
  enrichMinVerdict: VerdictBar;
  /** Minimum verdict to reveal a phone (8 credits) WITHOUT an override. */
  phoneMinVerdict: VerdictBar;
}

export const APOLLO_CREDIT_DEFAULTS: ApolloCreditSettings = {
  // Unset ⇒ disabled. The whole point of this work is that spend must be
  // switched on deliberately; a missing or corrupted row must never be the
  // thing that re-enables it.
  enabled: false,
  // ~1/3 of the account's 83,990, this app's agreed share of three tools.
  periodBudget: 27_996,
  anchorDay: DEFAULT_ANCHOR_DAY,
  safetyMargin: 200,
  userDefaultLimit: 2_000,
  phoneStopPct: 80,
  sweepReservePct: 50,
  thresholds: [50, 80, 95, 100],
  enrichMinVerdict: "not_weak",
  phoneMinVerdict: "strong",
};

function parseBool(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseInteger(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseVerdictBar(raw: string | null | undefined, fallback: VerdictBar): VerdictBar {
  const v = (raw ?? "").trim().toLowerCase();
  return (VERDICT_BAR_VALUES as readonly string[]).includes(v) ? (v as VerdictBar) : fallback;
}

function parseThresholds(raw: string | null | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  if (parsed.length === 0) return fallback;
  // Ascending + de-duped so "which thresholds have we crossed" is a simple
  // scan and a typo like "80,80" can't fire twice.
  return [...new Set(parsed)].sort((a, b) => a - b);
}

/**
 * Reads every apollo_* setting, applying defaults and clamping. Never throws
 * on bad data -- a garbage value falls back to its default rather than taking
 * enrichment down.
 *
 * It DOES propagate a database error, deliberately: the caller
 * (reserveEnrichment) treats an unreadable store as "deny the spend". If we
 * cannot account for a credit we must not spend it, so a DB outage has to be a
 * closed door rather than an unmetered window. This is the opposite of
 * isOverDailyLimit's fail-open behaviour, because the downside here is money
 * rather than a blocked capture.
 */
export async function getApolloCreditSettings(): Promise<ApolloCreditSettings> {
  const rows = await getDb()
    .select({ key: workspaceSettings.key, value: workspaceSettings.value })
    .from(workspaceSettings)
    .where(like(workspaceSettings.key, "apollo_%"));

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const d = APOLLO_CREDIT_DEFAULTS;
  const k = APOLLO_SETTING_KEYS;

  return {
    enabled: parseBool(map.get(k.enabled)),
    periodBudget: parseInteger(map.get(k.periodBudget), d.periodBudget, 0, 100_000_000),
    anchorDay: clampAnchorDay(map.get(k.anchorDay) ?? d.anchorDay),
    safetyMargin: parseInteger(map.get(k.safetyMargin), d.safetyMargin, 0, 100_000),
    userDefaultLimit: parseInteger(map.get(k.userDefaultLimit), d.userDefaultLimit, 0, 100_000_000),
    // Clamped to 1..100: a phone-stop of 0 would block reveals permanently
    // while looking like a configuration value rather than an outage.
    phoneStopPct: parseInteger(map.get(k.phoneStopPct), d.phoneStopPct, 1, 100),
    sweepReservePct: parseInteger(map.get(k.sweepReservePct), d.sweepReservePct, 0, 100),
    thresholds: parseThresholds(map.get(k.thresholds), d.thresholds),
    enrichMinVerdict: parseVerdictBar(map.get(k.enrichMinVerdict), d.enrichMinVerdict),
    phoneMinVerdict: parseVerdictBar(map.get(k.phoneMinVerdict), d.phoneMinVerdict),
  };
}

/** Does this verdict clear the given bar? */
export function verdictClearsBar(
  verdict: string | null | undefined,
  bar: VerdictBar,
): boolean {
  if (bar === "any") return true;
  // An unscored lead has no verdict yet. It clears only the loosest bars --
  // notably NOT `not_weak`, because "we have not looked" is different from
  // "we looked and it was acceptable", and the sweep always scores before it
  // reaches the gate.
  if (!verdict) return false;
  switch (bar) {
    case "strong":
      return verdict === "strong";
    case "strong_or_possible":
      return verdict === "strong" || verdict === "possible";
    case "not_weak":
      return verdict !== "weak";
    default:
      return false;
  }
}
