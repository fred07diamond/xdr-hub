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

    // Raised from 100/hr -- real xDR usage runs ~500 leads/day, often
    // enriched in one sitting right after a big import ("Enrich all" on a
    // list), so a single-user hourly cap needs real headroom above that.
    if (!(await checkRateLimit(ctx!.userEmail!, "enrich-lead-list-item", 1000))) {
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

    // Only request Apollo's paid phone reveal when we don't already have a
    // personal number on file -- re-enriching someone already revealed
    // shouldn't spend credits again.
    const revealPhone = !item.enrichedPhone;

    let person = null;
    try {
      person = await matchApolloPerson({ name: item.name, companyName: item.company, revealPhone });
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
    // Live-confirmed bug: Apollo's synchronous /people/match response only
    // carries contact.phone_numbers on the SAME call that requests a fresh
    // reveal -- a number delivered earlier via the async webhook is NOT
    // echoed back on a later plain re-enrich. Falling back to the
    // already-stored value here is required, or a routine re-enrich wipes
    // out a real number to null.
    const phone = extractApolloPhone(person) ?? item.enrichedPhone;

    // Reveal bookkeeping only applies when this call actually requested
    // one. A phone found synchronously means nothing async is pending, and
    // when revealPhone was false to begin with, leave existing reveal
    // fields untouched rather than overwriting them with this call's
    // (irrelevant) outcome. Matching key is Apollo's own person.id --
    // live-confirmed the webhook payload has no request_id, only a
    // `people[].id` identifying which person each result is for.
    const phoneRevealUpdate = !revealPhone
      ? {}
      : phone
        ? { phoneRevealStatus: "done" as const, phoneRevealRequestId: null, phoneRevealRequestedAt: null }
        : person?.id
          ? { phoneRevealStatus: "requested" as const, phoneRevealRequestId: person.id, phoneRevealRequestedAt: enrichedAt }
          : { phoneRevealStatus: "failed" as const, phoneRevealRequestId: null, phoneRevealRequestedAt: null };

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
        ...phoneRevealUpdate,
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
      phoneRevealStatus: "phoneRevealStatus" in phoneRevealUpdate ? phoneRevealUpdate.phoneRevealStatus : (item.phoneRevealStatus ?? null),
    };
  },
});
