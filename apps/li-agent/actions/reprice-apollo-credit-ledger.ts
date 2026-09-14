import { defineAction } from "@agent-native/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { apolloCreditLedger } from "../server/db/schema.js";
import { currentBillingPeriod } from "../server/helpers/apollo-credits/period.js";
import { getApolloCreditSettings } from "../server/helpers/apollo-credits/settings.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

// Corrects a whole CLASS of ledger rows once a real Apollo invoice says what
// they actually cost.
//
// This exists because several Apollo billing behaviours cannot be determined
// from the API: whether a no-match match still bills, whether a no-match
// reveal bills, whether a combined match+reveal is 9 or 8, whether
// organization enrich bills at all. Rather than bake a guess in permanently,
// the guard charges a conservative estimate and this action makes the estimate
// CORRECTABLE after the fact.
//
// Writes `actualCredits`, which every budget query already prefers via
// COALESCE(actual, estimated) -- so a correction takes effect on the next
// spend check with no recount and no separate refund path.
export default defineAction({
  description:
    "Apply a corrected per-call credit cost to a class of Apollo ledger rows after checking a real invoice, e.g. 'a phone reveal that found no number actually cost 0'. Selects by period, unit and outcome.",
  schema: z.object({
    periodStart: z.string().nullish(),
    unit: z.enum(["person_match", "phone_reveal", "org_enrich"]),
    // The narrowing that makes this safe to run: "phone_reveal rows whose
    // outcome was no_match", not "all phone reveals".
    outcome: z.string().nullish(),
    actualCredits: z.number().int().min(0).max(1_000),
    // Required acknowledgement of the row count, obtained from a dryRun first.
    // Repricing is a bulk rewrite of financial history; it must not be
    // possible to run it without having seen what it will touch.
    confirmRowCount: z.number().int().min(0).nullish(),
    dryRun: z.boolean().default(true),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: {
    summary: (args) =>
      args.dryRun
        ? `Previewed repricing ${args.unit} rows to ${args.actualCredits} credits`
        : `Repriced ${args.unit}${args.outcome ? ` / ${args.outcome}` : ""} rows to ${args.actualCredits} credits`,
  },
  run: async (input, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();

    const settings = await getApolloCreditSettings();
    const period = input.periodStart ?? currentBillingPeriod(settings.anchorDay).key;

    const conditions = [
      eq(apolloCreditLedger.periodStart, period),
      eq(apolloCreditLedger.unit, input.unit),
      // Never touch voided rows: they were never charged, and giving them a
      // cost would resurrect spend that did not happen.
      inArray(apolloCreditLedger.status, ["reserved", "committed", "pending_webhook", "reconciled"]),
    ];
    if (input.outcome) conditions.push(eq(apolloCreditLedger.outcome, input.outcome));

    const where = and(...conditions);

    const matches = await db
      .select({
        id: apolloCreditLedger.id,
        estimatedCredits: apolloCreditLedger.estimatedCredits,
        actualCredits: apolloCreditLedger.actualCredits,
      })
      .from(apolloCreditLedger)
      .where(where);

    const before = matches.reduce((s, r) => s + (r.actualCredits ?? r.estimatedCredits), 0);
    const after = matches.length * input.actualCredits;

    if (input.dryRun) {
      return {
        ok: true as const,
        dryRun: true as const,
        periodStart: period,
        rowCount: matches.length,
        creditsBefore: before,
        creditsAfter: after,
        delta: after - before,
        // Echo the count the caller must confirm to actually apply this.
        confirmRowCount: matches.length,
      };
    }

    if (input.confirmRowCount == null) {
      return {
        ok: false as const,
        error: "Run with dryRun first, then pass confirmRowCount to apply.",
      };
    }
    if (input.confirmRowCount !== matches.length) {
      // The set moved between the preview and the apply -- most likely a
      // webhook landed. Refuse rather than rewrite a set nobody looked at.
      return {
        ok: false as const,
        error: `Row count changed since the preview (${input.confirmRowCount} → ${matches.length}). Re-run the dry run.`,
      };
    }

    await db
      .update(apolloCreditLedger)
      .set({
        actualCredits: input.actualCredits,
        status: "reconciled",
        note: sql`COALESCE(${apolloCreditLedger.note} || ' | ', '') || ${`repriced to ${input.actualCredits}`}`,
        updatedAt: new Date().toISOString(),
      })
      .where(where);

    return {
      ok: true as const,
      dryRun: false as const,
      periodStart: period,
      rowCount: matches.length,
      creditsBefore: before,
      creditsAfter: after,
      delta: after - before,
    };
  },
});
