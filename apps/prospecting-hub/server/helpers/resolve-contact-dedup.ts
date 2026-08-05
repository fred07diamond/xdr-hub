import { or, sql } from "@agent-native/core/db/schema";
import type { getDb } from "../db/index.js";
import { contacts } from "../db/schema.js";
import { escapeLikePattern, normalizeLinkedinUrl } from "./normalize-linkedin-url.js";

type Db = ReturnType<typeof getDb>;

// Extracted from run-sourcing-rule-pipeline.ts's resolveContact() so
// run-marketing-rule-pipeline.ts can run the identical check: a HubSpot
// contact being synced might already exist as a `prospector`/`commonroom`-
// sourced row from an earlier Prospected run on the same person (same-source
// (externalId, source) dedup only catches a re-sync of the SAME source, not
// this cross-source case). Matches by exact email OR normalized LinkedIn
// vanity-slug against contacts from ANY source — the caller is expected to
// have already ruled out a same-source (externalId, source) match before
// calling this, since this only ever answers "does a DIFFERENT contact row
// already represent this same person."
export async function findCrossSourceMatch(
  db: Db,
  params: { email: string | null; linkedinUrl: string | null },
): Promise<{ id: string } | null> {
  const linkedinSlug = normalizeLinkedinUrl(params.linkedinUrl);

  const dedupConditions = [];
  if (params.email) {
    dedupConditions.push(sql`LOWER(${contacts.email}) = LOWER(${params.email})`);
  }
  if (linkedinSlug) {
    // Coarse SQL-level candidate filter only — a leading-wildcard LIKE can't
    // use a btree index, so this over-fetches candidates and the exact
    // normalized-slug comparison below narrows to a real match.
    dedupConditions.push(
      sql`LOWER(${contacts.linkedinUrl}) LIKE LOWER(${`%${escapeLikePattern(linkedinSlug)}%`}) ESCAPE '\\'`,
    );
  }
  if (dedupConditions.length === 0) return null;

  const dedupCandidates = await db
    .select({ id: contacts.id, email: contacts.email, linkedinUrl: contacts.linkedinUrl })
    .from(contacts)
    .where(or(...dedupConditions))
    .limit(25);

  const match = dedupCandidates.find((candidate) => {
    if (params.email && candidate.email && candidate.email.toLowerCase() === params.email.toLowerCase()) {
      return true;
    }
    if (linkedinSlug && normalizeLinkedinUrl(candidate.linkedinUrl) === linkedinSlug) {
      return true;
    }
    return false;
  });

  return match ? { id: match.id } : null;
}
