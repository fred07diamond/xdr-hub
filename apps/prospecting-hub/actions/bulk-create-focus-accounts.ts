import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { focusAccounts } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Bulk-create Focus Accounts for the caller from a batch (e.g. companies picked while browsing an AE's/XDR's HubSpot book of accounts). Skips any company the caller already has a Focus Account for (case-insensitive name match) — unlike create-focus-account, which has no dedup check since it's a one-at-a-time manual flow.",
  schema: z.object({
    accounts: z
      .array(
        z.object({
          companyName: z.string().min(1),
          companyDomain: z.string().nullish(),
        }),
      )
      .min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ accounts }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const existing = await db
      .select({ companyName: focusAccounts.companyName })
      .from(focusAccounts)
      .where(eq(focusAccounts.ownerEmail, ownerEmail));
    const existingNames = new Set(existing.map((row) => row.companyName.toLowerCase()));

    let created = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const account of accounts) {
      const key = account.companyName.toLowerCase();
      if (existingNames.has(key)) {
        skipped++;
        continue;
      }
      existingNames.add(key); // guard against duplicate names within the same batch too
      await db.insert(focusAccounts).values({
        id: nanoid(),
        ownerEmail,
        companyName: account.companyName,
        companyDomain: account.companyDomain ?? null,
        tier: null,
        createdAt: now,
      });
      created++;
    }

    return { created, skipped };
  },
});
