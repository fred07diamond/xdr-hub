import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";
import { REVEAL_CREDITS, revealPhoneForRecord } from "../server/helpers/reveal-phone-for-record.js";

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

    // Every gate lives in revealPhoneForRecord, shared with the extension
    // path. See that file for why this is not duplicated per caller.
    const outcome = await revealPhoneForRecord({
      row,
      source: source === "prospect" ? "prospect" : "lead_list_item",
      actorEmail,
      override,
      trigger: ctx?.caller === "tool" ? "agent" : "manual",
    });

    if (!outcome.ok) return { ...outcome, ok: false as const };
    return { ...outcome, ok: true as const, overrideReason: overrideReason ?? null };
  },
});
