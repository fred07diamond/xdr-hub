import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { leadListItems } from "../db/schema.js";
import { matchApolloPerson, enrichApolloOrganization, extractApolloPhone } from "./apollo-client.js";

type Db = ReturnType<typeof getDb>;
type LeadListItem = typeof leadListItems.$inferSelect;

export interface EnrichLeadListItemResult {
  enrichmentStatus: "done" | "not_found" | "failed";
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  enrichmentError: string | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
}

// Apollo person+org lookup, shared verbatim between the manual "Enrich"
// button (actions/enrich-lead-list-item.ts) and the automatic background
// pipeline (server/helpers/lead-pipeline-sweep.ts) -- one implementation so
// the two paths can't drift apart. Writes the resulting columns onto the
// given lead_list_items row and returns the same shape both callers expose.
export async function enrichLeadListItem(db: Db, item: LeadListItem): Promise<EnrichLeadListItemResult> {
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
    person = await matchApolloPerson({ name: item.name ?? "", companyName: item.company, revealPhone });
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
    .where(eq(leadListItems.id, item.id));

  return {
    enrichmentStatus: status,
    enrichedEmail: person?.email ?? null,
    enrichedTitle: person?.title ?? null,
    enrichedPhone: phone,
    enrichedLinkedinUrl: person?.linkedin_url ?? null,
    enrichedCompanyIndustry: organization?.industry ?? null,
    enrichedCompanySize: organization?.estimated_num_employees ?? null,
    enrichmentError,
    phoneRevealStatus: ("phoneRevealStatus" in phoneRevealUpdate ? phoneRevealUpdate.phoneRevealStatus : item.phoneRevealStatus) ?? null,
  };
}
