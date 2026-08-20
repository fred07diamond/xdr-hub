import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { matchApolloPerson, enrichApolloOrganization, extractApolloPhone } from "../server/helpers/apollo-client.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

export default defineAction({
  description:
    "Enrich a single captured prospect with Apollo.io person + company data (email, title, LinkedIn URL, company industry/size). On-demand only — never runs automatically at capture time.",
  schema: z.object({
    id: z.string(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);

    const rows = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, id), ownerFilter))
      .limit(1);
    const prospect = rows[0];
    if (!prospect) throw new Error("Prospect not found or access denied");

    // Raised from 100/hr to match enrich-lead-list-item.ts -- real xDR usage
    // runs ~500 leads/day, often enriched in one sitting.
    if (!(await checkRateLimit(ctx?.userEmail ?? "anonymous", "enrich-prospect", 1000))) {
      return { ok: false, error: "Rate limit reached — try again shortly." };
    }

    if (!prospect.name) {
      return { ok: false, error: "Prospect has no name to match against Apollo." };
    }

    const now = new Date().toISOString();
    await db.update(prospects).set({ enrichmentStatus: "enriching", updatedAt: now }).where(eq(prospects.id, id));

    // Person Match and Organization Enrich are independent Apollo endpoints
    // with independently-scoped API-key permissions — each is wrapped
    // separately so a scope problem on one doesn't block whichever data the
    // other still gets. Mirrors apps/prospecting-hub/actions/enrich-contact-
    // with-apollo.ts and enrich-lead-list-item.ts.
    const warnings: string[] = [];

    // Only request Apollo's paid phone reveal when we don't already have a
    // personal number on file -- re-enriching someone already revealed
    // shouldn't spend credits again.
    const revealPhone = !prospect.enrichedPhone;

    let person = null;
    try {
      person = await matchApolloPerson({ name: prospect.name, companyName: prospect.company, revealPhone });
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
    const phone = extractApolloPhone(person) ?? prospect.enrichedPhone;

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
      .update(prospects)
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
        enrichmentSource: person || organization ? "apollo" : prospect.enrichmentSource,
        enrichedEmailStatus: person?.email_status ?? null,
        updatedAt: enrichedAt,
        ...phoneRevealUpdate,
      })
      .where(eq(prospects.id, id));

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
      phoneRevealStatus: "phoneRevealStatus" in phoneRevealUpdate ? phoneRevealUpdate.phoneRevealStatus : (prospect.phoneRevealStatus ?? null),
    };
  },
});
