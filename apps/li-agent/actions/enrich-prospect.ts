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

    if (!(await checkRateLimit(ctx?.userEmail ?? "anonymous", "enrich-prospect", 100))) {
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

    let person = null;
    try {
      person = await matchApolloPerson({ name: prospect.name, companyName: prospect.company });
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
        updatedAt: enrichedAt,
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
    };
  },
});
