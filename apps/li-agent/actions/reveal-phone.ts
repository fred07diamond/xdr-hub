import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";
import { getEnrichmentBudgetState } from "../server/helpers/apollo-credits/guard.js";
import { verdictClearsBar } from "../server/helpers/apollo-credits/settings.js";
import { enrichApolloRecord } from "../server/helpers/enrich-apollo-record.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// Phone reveal as its OWN explicit action, not a side effect of a generic
// enrich.
//
// This is the single most important cost change in the credit work. It used to
// ride along invisibly inside every enrich (`revealPhone = !enrichedPhone`),
// so an unattended sweep pass spent 9 credits per lead instead of 1 and
// nobody chose it. Now an 8-credit spend is a deliberate, attributable
// decision by a named person.
//
// ONE action serves both tables so the gate cannot drift between them.

const REVEAL_CREDITS = 8;

export default defineAction({
  description:
    "Reveal one lead's personal phone number via Apollo. Costs 8 Apollo credits (eight times an email lookup), so it is gated on lead fit and requires explicit confirmation. Never called automatically.",
  schema: z.object({
    source: z.enum(["lead_list_item", "prospect"]),
    id: z.string().min(1),
    /**
     * Set only when the user has knowingly chosen to spend 8 credits on a lead
     * that does not clear the fit bar. Recorded on the ledger row and on the
     * lead, so an admin can see whether the gate is being respected.
     */
    override: z.boolean().default(false),
    overrideReason: z.string().max(500).nullish(),
    /**
     * The client must echo the exact cost. A stale client or a blind retry
     * therefore cannot spend by accident, and the price is structurally part
     * of the request rather than a number the server hopes the UI displayed.
     */
    confirmCredits: z.literal(REVEAL_CREDITS),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: {
    target: (args) => ({ type: args.source, id: args.id }),
    summary: (args) =>
      `Apollo phone reveal (${REVEAL_CREDITS} credits)${args.override ? " — OVERRIDE on a lead below the fit bar" : ""}`,
  },
  run: async ({ source, id, override, overrideReason }, ctx) => {
    const db = getDb();
    const actorEmail = ctx?.userEmail ?? null;
    if (!actorEmail) return { ok: false as const, code: "unauthorized", error: "Sign in to reveal a phone number." };

    // Ownership. A reveal spends shared credits, so it must not be possible to
    // trigger one against someone else's lead.
    let row: typeof prospects.$inferSelect | typeof leadListItems.$inferSelect | undefined;
    if (source === "prospect") {
      const [found] = await db
        .select()
        .from(prospects)
        .where(and(eq(prospects.id, id), actorEmail ? eq(prospects.ownerEmail, actorEmail) : isNull(prospects.ownerEmail)))
        .limit(1);
      row = found;
    } else {
      const [found] = await db.select().from(leadListItems).where(eq(leadListItems.id, id)).limit(1);
      if (found) {
        const [list] = await db.select({ ownerEmail: leadLists.ownerEmail }).from(leadLists).where(eq(leadLists.id, found.listId));
        if (list?.ownerEmail === actorEmail) row = found;
      }
    }
    if (!row) return { ok: false as const, code: "not_found", error: "Lead not found, or not yours." };

    if (!(await checkRateLimit(actorEmail, "apollo-enrichment", 250))) {
      return { ok: false as const, code: "rate_limited", error: "Too many enrichment calls in the last hour — try again shortly." };
    }

    // ── Zero-spend short circuits, before anything is reserved ─────────────
    if (row.enrichedPhone) {
      return { ok: false as const, code: "already_revealed", error: "This lead already has a phone number.", enrichedPhone: row.enrichedPhone };
    }
    if (row.phoneRevealStatus === "requested") {
      return { ok: false as const, code: "reveal_pending", error: "A reveal for this lead is already in flight — Apollo delivers the number by callback." };
    }
    if (row.phoneRevealStatus === "no_match") {
      // Apollo has told us it holds no personal number for this person.
      // Paying 8 credits again to be told the same thing is pure waste.
      return { ok: false as const, code: "no_number_known", error: "Apollo has no personal number on file for this lead." };
    }

    let state;
    try {
      state = await getEnrichmentBudgetState();
    } catch {
      return { ok: false as const, code: "store_unavailable", error: "Apollo credit accounting is unavailable, so enrichment is paused." };
    }

    if (!state.enabled) {
      return { ok: false as const, code: "apollo_disabled", error: "Apollo enrichment is turned off for this workspace." };
    }
    if (state.hardStopped) {
      return { ok: false as const, code: "budget_exhausted", error: `The workspace is out of Apollo credits for this period. Credits reset ${state.resetLabel}.`, resetLabel: state.resetLabel };
    }
    // The phone tier is a POLICY, not a nag: an override covers the fit gate,
    // never the workspace running low. Deliberately checked before the fit
    // gate so the message explains the real blocker.
    if (state.phoneRevealsPaused) {
      return {
        ok: false as const,
        code: "phone_budget_blocked",
        error: `Phone reveals are paused until ${state.resetLabel} — the workspace has used ${Math.round(state.spentPct)}% of its Apollo credits. Email enrichment still works.`,
        resetLabel: state.resetLabel,
        spentPct: Math.round(state.spentPct),
      };
    }

    // ── The fit gate ───────────────────────────────────────────────────────
    const clears = verdictClearsBar(row.fitVerdict, state.settings.phoneMinVerdict);
    if (!clears && !override) {
      return {
        ok: false as const,
        code: "fit_gate",
        // The client uses these to render the two-step override, so it can
        // state the actual verdict and reason rather than a generic warning.
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
        trigger: ctx?.caller === "tool" ? "agent" : "manual",
        actorEmail,
        revealPhone: true,
        overrideFitGate: !clears && override,
      },
    );

    if (result.blockedReason) {
      return { ok: false as const, code: result.blockedReason, error: result.blockedMessage };
    }

    return {
      ok: true as const,
      // "requested" is the normal outcome: Apollo delivers the number
      // asynchronously by webhook, usually within seconds.
      phoneRevealStatus: result.phoneRevealStatus,
      enrichedPhone: result.enrichedPhone,
      creditsCharged: REVEAL_CREDITS + 1,
      wasOverride: !clears && override,
      overrideReason: overrideReason ?? null,
    };
  },
});
