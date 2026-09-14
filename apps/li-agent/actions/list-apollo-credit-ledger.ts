import { defineAction } from "@agent-native/core";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { apolloCreditLedger } from "../server/db/schema.js";
import { currentBillingPeriod } from "../server/helpers/apollo-credits/period.js";
import { getApolloCreditSettings } from "../server/helpers/apollo-credits/settings.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

// The ledger export. This is the artifact the credit pilot runs on: dump a
// period, add up the credits, and compare against Apollo's real balance.
//
// Distinct from list-enrichment-audit-log, which reports WHO HAS DATA by
// deriving from current row state -- it cannot see a re-enrich (enrichedAt is
// overwritten), a voided reservation, or an errored call, and has no trigger
// or cost attribution. This one reports WHAT WE PAID.
export default defineAction({
  description:
    "Export the Apollo credit ledger for a billing period: every credit-bearing call with its unit, cost, trigger, actor, fit verdict at spend time, and outcome. The basis for reconciling against an Apollo invoice.",
  schema: z.object({
    // Defaults to the current period rather than all of history: the whole
    // point is comparing one period against one Apollo balance.
    periodStart: z.string().nullish(),
    unit: z.enum(["person_match", "phone_reveal", "org_enrich"]).nullish(),
    trigger: z.enum(["manual", "sweep", "agent"]).nullish(),
    actorEmail: z.string().nullish(),
    // Voided reservations are EXCLUDED by default -- they cost nothing and
    // would inflate a reconciliation -- but remain fetchable, because a pile
    // of them is itself a signal (processes dying between reserve and settle).
    includeVoided: z.boolean().default(false),
    limit: z.number().int().min(1).max(20_000).default(5_000),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (input, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();

    const settings = await getApolloCreditSettings();
    const period = input.periodStart ?? currentBillingPeriod(settings.anchorDay).key;

    const conditions = [eq(apolloCreditLedger.periodStart, period)];
    if (input.unit) conditions.push(eq(apolloCreditLedger.unit, input.unit));
    if (input.trigger) conditions.push(eq(apolloCreditLedger.trigger, input.trigger));
    if (input.actorEmail) conditions.push(eq(apolloCreditLedger.actorEmail, input.actorEmail.toLowerCase()));
    if (!input.includeVoided) {
      conditions.push(
        inArray(apolloCreditLedger.status, ["reserved", "committed", "pending_webhook", "reconciled"]),
      );
    }

    const rows = await db
      .select()
      .from(apolloCreditLedger)
      .where(and(...conditions))
      .orderBy(desc(apolloCreditLedger.createdAt))
      .limit(input.limit);

    const charged = rows.map((r) => ({
      ...r,
      // The single number every budget query uses, surfaced explicitly so an
      // export can be summed without re-deriving the COALESCE.
      creditsCharged: r.actualCredits ?? r.estimatedCredits,
      isOverride: r.isOverride === 1,
      // Makes the reconciliation gap visible per row rather than only in
      // aggregate: an unreconciled reveal is an estimate, not a fact.
      reconciled: r.actualCredits != null,
    }));

    const total = charged.reduce((sum, r) => sum + r.creditsCharged, 0);
    const estimatedOnly = charged
      .filter((r) => !r.reconciled)
      .reduce((sum, r) => sum + r.creditsCharged, 0);

    return {
      periodStart: period,
      rowCount: charged.length,
      truncated: charged.length === input.limit,
      totalCredits: total,
      // How much of the total is still a GUESS. Apollo only confirms cost for
      // the reveal leg via webhook, so a match-heavy period is almost entirely
      // estimated -- which is exactly what the pilot is meant to resolve.
      estimatedCredits: estimatedOnly,
      reconciledCredits: total - estimatedOnly,
      rows: charged,
    };
  },
});
