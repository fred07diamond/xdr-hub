import { getDb } from "../db/index.js";
import type { leadListItems, prospects } from "../db/schema.js";
import { getEnrichmentBudgetState } from "./apollo-credits/guard.js";
import { verdictClearsBar } from "./apollo-credits/settings.js";
import { enrichApolloRecord } from "./enrich-apollo-record.js";
import { checkRateLimit } from "./rate-limit.js";

/**
 * Every gate a phone reveal has to clear, in one place.
 *
 * Extracted from actions/reveal-phone.ts when the Chrome extension needed the
 * same capability. The alternative was a second copy of roughly a hundred
 * lines of spend policy in an extension-facing action, and this codebase
 * already has the receipt for what that costs: the enrichment logic was
 * duplicated across two actions, the copies drifted, and the version that kept
 * `revealPhone = !enrichedPhone` made every unattended sweep pass spend 9
 * credits per lead instead of 1.
 *
 * So the extension does not get its own gates. It gets this one.
 *
 * The caller still does the row LOOKUP, because that genuinely differs -- the
 * dashboard has an id, the extension has a LinkedIn profile URL -- and it is
 * where ownership is enforced. Everything after the row is shared.
 */

export const REVEAL_CREDITS = 8;

export type RevealableRow = typeof prospects.$inferSelect | typeof leadListItems.$inferSelect;

export type RevealSource = "prospect" | "lead_list_item";

export type RevealPhoneOutcome =
  | {
      ok: false;
      code: string;
      error: string;
      /** Populated on `fit_gate` so a client can render the override step. */
      fitVerdict?: string | null;
      fitReason?: string | null;
      requiredVerdict?: string;
      resetLabel?: string;
      spentPct?: number;
      enrichedPhone?: string | null;
    }
  | {
      ok: true;
      phoneRevealStatus: string | null;
      enrichedPhone: string | null;
      creditsCharged: number;
      wasOverride: boolean;
    };

export async function revealPhoneForRecord(args: {
  row: RevealableRow;
  source: RevealSource;
  actorEmail: string;
  override: boolean;
  /** "manual" from a UI, "agent" from a tool call. */
  trigger: "manual" | "agent";
}): Promise<RevealPhoneOutcome> {
  const { row, source, actorEmail, override, trigger } = args;
  const db = getDb();

  if (!(await checkRateLimit(actorEmail, "apollo-enrichment", 250))) {
    return {
      ok: false,
      code: "rate_limited",
      error: "Too many enrichment calls in the last hour — try again shortly.",
    };
  }

  // ── Zero-spend short circuits, before anything is reserved ───────────────
  if (row.enrichedPhone) {
    return {
      ok: false,
      code: "already_revealed",
      error: "This lead already has a phone number.",
      enrichedPhone: row.enrichedPhone,
    };
  }
  if (row.phoneRevealStatus === "requested") {
    return {
      ok: false,
      code: "reveal_pending",
      error: "A reveal for this lead is already in flight — Apollo delivers the number by callback.",
    };
  }
  if (row.phoneRevealStatus === "no_match") {
    // Apollo has told us it holds no personal number for this person. Paying 8
    // credits again to be told the same thing is pure waste.
    return {
      ok: false,
      code: "no_number_known",
      error: "Apollo has no personal number on file for this lead.",
    };
  }

  let state;
  try {
    state = await getEnrichmentBudgetState();
  } catch {
    return {
      ok: false,
      code: "store_unavailable",
      error: "Apollo credit accounting is unavailable, so enrichment is paused.",
    };
  }

  if (!state.enabled) {
    return { ok: false, code: "apollo_disabled", error: "Apollo enrichment is turned off for this workspace." };
  }
  if (state.hardStopped) {
    return {
      ok: false,
      code: "budget_exhausted",
      error: `The workspace is out of Apollo credits for this period. Credits reset ${state.resetLabel}.`,
      resetLabel: state.resetLabel,
    };
  }
  // The phone tier is a POLICY, not a nag: an override covers the fit gate,
  // never the workspace running low. Deliberately checked before the fit gate
  // so the message explains the real blocker.
  if (state.phoneRevealsPaused) {
    return {
      ok: false,
      code: "phone_budget_blocked",
      error: `Phone reveals are paused until ${state.resetLabel} — the workspace has used ${Math.round(state.spentPct)}% of its Apollo credits. Email enrichment still works.`,
      resetLabel: state.resetLabel,
      spentPct: Math.round(state.spentPct),
    };
  }

  // ── The fit gate ─────────────────────────────────────────────────────────
  const clears = verdictClearsBar(row.fitVerdict, state.settings.phoneMinVerdict);
  if (!clears && !override) {
    return {
      ok: false,
      code: "fit_gate",
      fitVerdict: row.fitVerdict ?? null,
      fitReason: row.fitReason ?? null,
      requiredVerdict: state.settings.phoneMinVerdict,
      error: row.fitVerdict
        ? `Phone reveals are reserved for stronger-fit leads. This lead scored ${row.fitVerdict}.`
        : "Phone reveals are reserved for scored leads. Score this lead first.",
    };
  }

  // A reveal necessarily rides on a /people/match call, so the real cost is
  // 1 (match) + 8 (reveal). The guard prices and records both legs.
  const result = await enrichApolloRecord(
    db,
    source === "prospect"
      ? { kind: "prospect", row: row as typeof prospects.$inferSelect }
      : { kind: "lead_list_item", row: row as typeof leadListItems.$inferSelect },
    {
      trigger,
      actorEmail,
      revealPhone: true,
      overrideFitGate: !clears && override,
    },
  );

  if (result.blockedReason) {
    return { ok: false, code: result.blockedReason, error: result.blockedMessage ?? "Blocked." };
  }

  return {
    ok: true,
    // "requested" is the normal outcome: Apollo delivers the number
    // asynchronously by webhook, usually within seconds.
    phoneRevealStatus: result.phoneRevealStatus ?? null,
    enrichedPhone: result.enrichedPhone ?? null,
    creditsCharged: REVEAL_CREDITS + 1,
    wasOverride: !clears && override,
  };
}
