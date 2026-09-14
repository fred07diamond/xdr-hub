import { eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { leadListItems, prospects } from "../db/schema.js";
import { enrichApolloOrganization, extractApolloPhone, matchApolloPerson } from "./apollo-client.js";

type Db = ReturnType<typeof getDb>;

// One Apollo person+org lookup, shared by every enrichment trigger in the app:
// the manual "Enrich" button on both tables, and the automatic background
// sweep.
//
// This used to be two copies -- server/helpers/enrich-lead-list-item.ts and an
// inlined duplicate inside actions/enrich-prospect.ts -- differing only in
// which table they wrote to. They had already drifted (the freshness guard
// landed in one before the other), and a second copy is exactly how the next
// drift happens. More importantly, credit metering has to live at ONE choke
// point or a call site can spend without being counted.

/**
 * The columns both `prospects` and `leadListItems` share. Verified field by
 * field: the enrichment column names are identical across the two tables,
 * which is what makes one implementation possible.
 */
export interface EnrichableRow {
  id: string;
  name: string | null;
  company: string | null;
  enrichmentStatus: string;
  enrichedAt: string | null;
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  companyDomain: string | null;
  enrichmentError: string | null;
  enrichmentSource: "apollo" | "apollo_phone_reveal" | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
}

export type EnrichTarget =
  | { kind: "lead_list_item"; row: typeof leadListItems.$inferSelect }
  | { kind: "prospect"; row: typeof prospects.$inferSelect };

export interface ApolloEnrichmentOutcome {
  enrichmentStatus: "done" | "not_found" | "failed";
  enrichedEmail: string | null;
  enrichedTitle: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
  enrichedCompanyIndustry: string | null;
  enrichedCompanySize: number | null;
  companyDomain: string | null;
  enrichmentError: string | null;
  phoneRevealStatus: "requested" | "done" | "no_match" | "failed" | null;
}

// Once Apollo has actually returned a usable result, holding onto it for
// this long before a re-check is worth spending real Apollo credits on --
// title/company/contact data drifts on a timescale of months, not the
// minutes between an import and the auto-sweep (or a re-click of "Enrich")
// picking the row up again. Only a complete "done" result is ever held this
// way -- idle/failed/not_found rows have nothing worth keeping and are
// always retried.
export const ENRICHMENT_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function isEnrichmentFresh(row: { enrichmentStatus: string; enrichedAt: string | null }): boolean {
  if (row.enrichmentStatus !== "done" || !row.enrichedAt) return false;
  return Date.now() - new Date(row.enrichedAt).getTime() < ENRICHMENT_STALE_AFTER_MS;
}

/** The already-stored values, returned when the row is still fresh. */
function outcomeFromStoredRow(row: EnrichableRow): ApolloEnrichmentOutcome {
  return {
    enrichmentStatus: row.enrichmentStatus as ApolloEnrichmentOutcome["enrichmentStatus"],
    enrichedEmail: row.enrichedEmail,
    enrichedTitle: row.enrichedTitle,
    enrichedPhone: row.enrichedPhone,
    enrichedLinkedinUrl: row.enrichedLinkedinUrl,
    enrichedCompanyIndustry: row.enrichedCompanyIndustry,
    enrichedCompanySize: row.enrichedCompanySize,
    companyDomain: row.companyDomain,
    enrichmentError: row.enrichmentError,
    phoneRevealStatus: row.phoneRevealStatus,
  };
}

/** Column values are identical between the two tables; only the target differs. */
async function persist(
  db: Db,
  target: EnrichTarget,
  values: Record<string, unknown>,
): Promise<void> {
  if (target.kind === "lead_list_item") {
    await db.update(leadListItems).set(values).where(eq(leadListItems.id, target.row.id));
    return;
  }
  await db.update(prospects).set(values).where(eq(prospects.id, target.row.id));
}

/**
 * Enriches one record from Apollo and writes the result onto its row.
 *
 * Checks isEnrichmentFresh() before ever touching Apollo, so the
 * "don't pay for what we already have" rule lives here once rather than being
 * re-implemented (or forgotten) at each call site.
 */
export async function enrichApolloRecord(
  db: Db,
  target: EnrichTarget,
): Promise<ApolloEnrichmentOutcome> {
  const row = target.row as EnrichableRow;

  if (isEnrichmentFresh(row)) return outcomeFromStoredRow(row);

  // Claim the row only once we know we are actually going to call Apollo.
  //
  // This write used to live in the CALLERS, before the freshness check -- so a
  // fresh row got flipped to "enriching" and then short-circuited without
  // anything writing a terminal status, stranding it there. On lead list items
  // the sweep's stale-claim reaper eventually reset it to idle and re-enriched
  // it, spending a credit on data we already had; on prospects there is no
  // reaper at all, so the row showed "Enriching…" forever. Owning the whole
  // lifecycle here means no call site can get that ordering wrong, and it is
  // also where a budget denial has to sit once metering lands -- a refused
  // spend must never leave a row claimed.
  await persist(db, target, { enrichmentStatus: "enriching", updatedAt: new Date().toISOString() });

  // Person Match and Organization Enrich are independent Apollo endpoints
  // with independently-scoped API-key permissions (live-confirmed elsewhere in
  // this workspace: a key can be authorized for one and rejected with a 403 on
  // the other) -- each is wrapped separately so a scope problem on one doesn't
  // block whichever data the other still gets. Mirrors
  // apps/prospecting-hub/actions/enrich-contact-with-apollo.ts.
  const warnings: string[] = [];

  // Only request Apollo's paid phone reveal when we don't already have a
  // personal number on file -- re-enriching someone already revealed
  // shouldn't spend credits again.
  const revealPhone = !row.enrichedPhone;

  let person = null;
  try {
    person = await matchApolloPerson({ name: row.name ?? "", companyName: row.company, revealPhone });
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
  const phone = extractApolloPhone(person) ?? row.enrichedPhone;

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

  await persist(db, target, {
    enrichmentStatus: status,
    enrichedEmail: person?.email ?? null,
    enrichedTitle: person?.title ?? null,
    enrichedPhone: phone,
    enrichedLinkedinUrl: person?.linkedin_url ?? null,
    enrichedCompanyIndustry: organization?.industry ?? null,
    enrichedCompanySize: organization?.estimated_num_employees ?? null,
    companyDomain: person?.organization?.primary_domain ?? row.companyDomain,
    enrichedAt,
    enrichmentError,
    enrichmentSource: person || organization ? "apollo" : row.enrichmentSource,
    enrichedEmailStatus: person?.email_status ?? null,
    updatedAt: enrichedAt,
    ...phoneRevealUpdate,
  });

  return {
    enrichmentStatus: status,
    enrichedEmail: person?.email ?? null,
    enrichedTitle: person?.title ?? null,
    enrichedPhone: phone,
    enrichedLinkedinUrl: person?.linkedin_url ?? null,
    enrichedCompanyIndustry: organization?.industry ?? null,
    enrichedCompanySize: organization?.estimated_num_employees ?? null,
    companyDomain: person?.organization?.primary_domain ?? row.companyDomain,
    enrichmentError,
    phoneRevealStatus:
      ("phoneRevealStatus" in phoneRevealUpdate ? phoneRevealUpdate.phoneRevealStatus : row.phoneRevealStatus) ?? null,
  };
}
