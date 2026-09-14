import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";

// A zero-cost quality filter, and the highest-leverage one available.
//
// Persona briefings already carry `avoidTitlesSearch`, documented in
// server/helpers/persona-briefing.ts as "a flat list of literal, individual
// job titles -- one real title a LinkedIn profile could actually show per
// entry", built explicitly for mechanical matching against a real search
// filter. A lead whose headline contains one of those is provably not worth a
// credit, and establishing that costs neither an Apollo call NOR an LLM call.
//
// Deliberately NOT used as a positive gate on `titles`/`fallbackTitles`: Sales
// Nav headlines are freeform taglines ("Building the future of X | ex-Google"),
// so a non-match is not evidence of a bad lead, and gating on it would
// silently suppress good leads with no way for a user to see why.

interface CachedBriefing {
  avoid: string[];
}

/**
 * Per-tick cache. The sweep processes a small batch per tick and personas
 * change rarely, so this avoids re-reading and re-parsing the same briefing
 * JSON for every lead. Scoped to one instance of the class, not module-level,
 * so a long-lived serverless process can't serve a stale briefing forever.
 */
export class AvoidTitleFilter {
  private cache = new Map<string, CachedBriefing>();

  private async load(personaId: string): Promise<CachedBriefing> {
    const hit = this.cache.get(personaId);
    if (hit) return hit;

    let avoid: string[] = [];
    try {
      const [row] = await getSharedDb()
        .select({ briefing: sharedPersonas.briefing })
        .from(sharedPersonas)
        .where(eq(sharedPersonas.id, personaId))
        .limit(1);
      if (row?.briefing) {
        const parsed = JSON.parse(row.briefing) as { avoidTitlesSearch?: unknown };
        if (Array.isArray(parsed.avoidTitlesSearch)) {
          avoid = parsed.avoidTitlesSearch
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            // Guard against a short/generic entry matching almost everything.
            // A 3-character "avoid" term would exclude most headlines by
            // accident, and a false exclusion is invisible to the user.
            .filter((t) => t.length >= 4);
        }
      }
    } catch {
      // No briefing, unparseable briefing, or a DB hiccup: filter nothing.
      // This is an optimisation, never a correctness gate -- failing open here
      // costs at most one credit on a lead that might have been skipped.
      avoid = [];
    }

    const entry = { avoid };
    this.cache.set(personaId, entry);
    return entry;
  }

  /**
   * Returns the matched avoid-title when this lead is one the ICP explicitly
   * excludes, else null.
   */
  async matchedAvoidTitle(
    personaId: string | null,
    headline: string | null,
    enrichedTitle: string | null,
  ): Promise<string | null> {
    if (!personaId) return null;
    const haystack = `${headline ?? ""} ${enrichedTitle ?? ""}`.toLowerCase();
    if (!haystack.trim()) return null;

    const { avoid } = await this.load(personaId);
    for (const term of avoid) {
      if (haystack.includes(term)) return term;
    }
    return null;
  }
}
