import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { matchApolloPerson, enrichApolloOrganization, extractApolloPhone } from "../server/helpers/apollo-client.js";
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

    // Verify the item exists and belongs to the requesting user's list.
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

    // Person Match and Organization Enrich are independent Apollo endpoints
    // with independently-scoped API-key permissions (live-confirmed
    // elsewhere in this workspace: a key can be authorized for one and
    // rejected with a 403 on the other) — each is wrapped separately so a
    // scope problem on one doesn't block whichever data the other still
    // gets. Mirrors apps/prospecting-hub/actions/enrich-contact-with-apollo.ts.
    const warnings: string[] = [];

    let person = null;
    try {
      person = await matchApolloPerson({ name: item.name, companyName: item.company });
    } catch (err) {
      warnings.push(`Person lookup: ${err instanceof Error ? err.message : String(err)}`);
    }

    let organization = null;
    try {
      organization = await enrichApolloOrganization({
        domain: person?.organization?.primary_domain ?? null,
        email: person?.email ?? null,
      });
    } catch (err) {
      warnings.push(`Organization lookup: ${err instanceof Error ? err.message : String(err)}`);
    }

    const enrichedAt = new Date().toISOString();
    const status = person || organization ? "done" : warnings.length > 0 ? "failed" : "not_found";
    const enrichmentError = warnings.length > 0 ? warnings.join(" | ") : null;
    const phone = extractApolloPhone(person);

    await db
      .update(leadListItems)
      .set({
        enrichmentStatus: status,
        enrichedEmail: person?.email ?? null,
        enrichedTitle: person?.title ?? null,
        enrichedPhone: phone,
        enrichedLinkedinUrl: person?.linkedin_url ?? null,
        enrichedCompanyIndustry: organization?.industry ?? null,
        enrichedCompanySize: organization?.estimated_num_employees ?? null,
        enrichedAt,
        enrichmentError,
        updatedAt: enrichedAt,
      })
      .where(eq(leadListItems.id, itemId));

    return {
      ok: true,
      enrichmentStatus: status,
      enrichedEmail: person?.email ?? null,
      enrichedTitle: person?.title ?? null,
      enrichedPhone: phone,
      enrichedLinkedinUrl: person?.linkedin_url ?? null,
      enrichedCompanyIndustry: organization?.industry ?? null,
      enrichedCompanySize: organization?.estimated_num_employees ?? null,
      enrichmentError,
      // TEMPORARY -- diagnosing a report that enrichedPhone shows the
      // company's number instead of the person's. Remove once resolved.
      _debugPhone: {
        sentToApollo: { name: item.name, companyName: item.company },
        matchedPersonName: person?.name,
        matchedPersonTitle: person?.title,
        matchedOrgName: person?.organization?.name,
        matchedOrgDomain: person?.organization?.primary_domain,
        hasContact: !!person?.contact,
        phoneNumbers: person?.contact?.phone_numbers ?? [],
      },
    };
  },
});
