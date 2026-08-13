import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { matchApolloPerson, enrichApolloOrganization } from "../server/helpers/apollo-client.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

export default defineAction({
  description:
    "Enrich a single Sales Navigator lead list item with Apollo.io person + company data (email, title, LinkedIn URL, company industry/size). Dashboard-only, on-demand — never runs automatically at import time.",
  schema: z.object({
    itemId: z.string(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId }, ctx) => {
    const db = getDb();

    // Same ownership check shape as update-lead-list-item.ts.
    const itemRows = await db.select().from(leadListItems).where(eq(leadListItems.id, itemId));
    const item = itemRows[0];
    if (!item) throw new Error("Item not found");
    const listRows = await db.select().from(leadLists).where(eq(leadLists.id, item.listId));
    if (!listRows[0] || listRows[0].ownerEmail !== ctx!.userEmail) throw new Error("Not authorized");

    if (!(await checkRateLimit(ctx!.userEmail!, "enrich-lead-list-item", 100))) {
      return { ok: false, error: "Rate limit reached — try again shortly." };
    }

    if (!item.name) {
      return { ok: false, error: "Lead has no name to match against Apollo." };
    }

    const now = new Date().toISOString();
    await db.update(leadListItems).set({ enrichmentStatus: "enriching", updatedAt: now }).where(eq(leadListItems.id, itemId));

    let person = null;
    let organization = null;
    try {
      [person, organization] = await Promise.all([
        matchApolloPerson({ name: item.name, companyName: item.company }),
        enrichApolloOrganization({ companyName: item.company }),
      ]);
    } catch (err) {
      await db
        .update(leadListItems)
        .set({ enrichmentStatus: "failed", updatedAt: new Date().toISOString() })
        .where(eq(leadListItems.id, itemId));
      return { ok: false, error: err instanceof Error ? err.message : "Apollo enrichment failed." };
    }

    const enrichedAt = new Date().toISOString();
    const status = person || organization ? "done" : "not_found";
    await db
      .update(leadListItems)
      .set({
        enrichmentStatus: status,
        enrichedEmail: person?.email ?? null,
        enrichedTitle: person?.title ?? null,
        enrichedLinkedinUrl: person?.linkedin_url ?? null,
        enrichedCompanyIndustry: organization?.industry ?? null,
        enrichedCompanySize: organization?.estimated_num_employees ?? null,
        enrichedAt,
        updatedAt: enrichedAt,
      })
      .where(eq(leadListItems.id, itemId));

    return {
      ok: true,
      enrichmentStatus: status,
      enrichedEmail: person?.email ?? null,
      enrichedTitle: person?.title ?? null,
      enrichedLinkedinUrl: person?.linkedin_url ?? null,
      enrichedCompanyIndustry: organization?.industry ?? null,
      enrichedCompanySize: organization?.estimated_num_employees ?? null,
    };
  },
});
