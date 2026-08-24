import { eq } from "drizzle-orm";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import type { PersonaBriefing } from "./persona-briefing.js";

// LinkedIn's query mini-language uses literal "(" / ")" as structural
// nesting delimiters throughout the whole `query=` value, decoded one level
// at a time. encodeURIComponent leaves parens untouched (they're in its
// unreserved set), so a value containing a literal paren -- e.g. Boolean
// grouping in a keyword string -- collides with that structural syntax and
// corrupts the parse (confirmed: this produced a real Sales Nav server
// error). Fix: push parens down one encoding level, same as colons/spaces
// in "text" values are pre-encoded before the outer encode pass doubles
// them -- so a literal "(" survives as inert text ("%28") through
// structural parsing instead of being read as nesting.
export function encodeLeaf(value: string | number): string {
  return encodeURIComponent(String(value)).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

// id is optional -- confirmed from a real captured CURRENT_TITLE filter: a
// title LinkedIn's own typeahead resolved to its internal taxonomy gets a
// real numeric id (e.g. id:3294,text:"Senior Design Manager"), but a title
// typed free-form with no taxonomy match just omits id entirely
// (text:"Director of Design Systems",selectionType:INCLUDED) and still
// works as a real filter value. We have no taxonomy id table for titles,
// so every title entry this file generates omits id on purpose -- that's
// the same valid shape LinkedIn itself uses for an unmatched title, not a
// guess.
export function buildFilterEntry(
  type: string,
  entries: Array<{ id?: string | number; text: string; selectionType?: "INCLUDED" | "EXCLUDED" }>,
): string {
  const values = entries
    .map((e) => {
      const parts: string[] = [];
      if (e.id !== undefined && e.id !== null && e.id !== "") parts.push(`id:${encodeLeaf(e.id)}`);
      parts.push(`text:${encodeLeaf(e.text)}`);
      parts.push(`selectionType:${e.selectionType ?? "INCLUDED"}`);
      return `(${parts.join(",")})`;
    })
    .join(",");
  return `(type:${type},values:List(${values}))`;
}

export interface PersonaSalesNavSearch {
  searchUrl: string;
  summary: string;
  matchedPersonaName: string;
  appliedFilters: string[];
}

/**
 * Extracted from generate-sales-nav-search.ts's persona fast path so it can
 * be reused by generate-persona-search-link.ts (the A2A/session-authenticated
 * sibling used by prospecting-hub's prospect-pull-plan reconcile step) without
 * duplicating the title-tier/exclude-title logic. generate-sales-nav-search.ts
 * itself is unchanged in behavior -- it just calls this now instead of
 * inlining it.
 *
 * Returns null when the persona doesn't exist or has no generated briefing
 * with titles yet -- the caller decides what "no result" means for it
 * (generate-sales-nav-search.ts falls through to its legacy free-text flow;
 * generate-persona-search-link.ts returns an error).
 */
export async function buildPersonaSalesNavSearch(
  db: ReturnType<typeof getSharedDb>,
  options: { personaId: string; companyName?: string | null },
): Promise<PersonaSalesNavSearch | null> {
  const [persona] = await db
    .select({ id: sharedPersonas.id, name: sharedPersonas.name, briefing: sharedPersonas.briefing })
    .from(sharedPersonas)
    .where(eq(sharedPersonas.id, options.personaId))
    .limit(1);

  const briefing: PersonaBriefing | null = persona?.briefing ? JSON.parse(persona.briefing) : null;
  const primaryTitles = briefing?.titles ?? [];
  const fallbackTitles = briefing?.fallbackTitles ?? [];
  // avoidTitlesSearch, NOT avoidTitles -- avoidTitles is deliberately
  // grouped/readable prose for the briefing sheet (e.g. "Creative Director /
  // Brand Designer / Art Director", or a parenthetical example list), which
  // is not a valid literal filter value. Pasting it straight into a
  // Current-job-title exclude entry produced nonsense chips.
  // avoidTitlesSearch is the flat, one-real-title-per-entry form generated
  // specifically for this.
  const avoidTitles = briefing?.avoidTitlesSearch ?? [];

  if (!persona || (!primaryTitles.length && !fallbackTitles.length)) return null;

  const MAX_TITLES = 25;
  // Sales Nav's own "Current job title" filter lets a rep mark individual
  // entries as Exclude within the same filter -- that's why buildFilterEntry
  // already takes a per-entry selectionType rather than one for the whole
  // call. Primary and fallback tiers both become INCLUDED (no way to
  // conditionally search "fallback only if this account has none of the
  // primary titles" -- Sales Nav has no such conditional -- so both tiers go
  // in to maximize recall), and avoidTitles become EXCLUDED so a "wrong
  // buyer" the briefing flagged as looking close never shows up in results.
  const includeTitles = Array.from(new Set([...primaryTitles, ...fallbackTitles])).slice(0, MAX_TITLES);
  const excludeTitles = Array.from(new Set(avoidTitles)).slice(0, MAX_TITLES);

  const filterEntries: string[] = [
    buildFilterEntry("CURRENT_TITLE", [
      ...includeTitles.map((text) => ({ text, selectionType: "INCLUDED" as const })),
      ...excludeTitles.map((text) => ({ text, selectionType: "EXCLUDED" as const })),
    ]),
  ];
  const appliedFilters: string[] = [`Current job title: ${includeTitles.join(", ")}`];
  if (excludeTitles.length) appliedFilters.push(`Excludes wrong-buyer titles: ${excludeTitles.join(", ")}`);

  const trimmedCompanyName = options.companyName?.trim() || "";
  if (trimmedCompanyName) {
    filterEntries.push(buildFilterEntry("CURRENT_COMPANY", [{ text: trimmedCompanyName }]));
    appliedFilters.push(`Current company: ${trimmedCompanyName}`);
  }

  const rawQuery = `(filters:List(${filterEntries.join(",")}))`;
  const searchUrl = `https://www.linkedin.com/sales/search/people?query=${encodeURIComponent(rawQuery)}`;

  return {
    searchUrl,
    summary: briefing?.positioning || `${persona.name} at ${trimmedCompanyName || "this account"}`,
    matchedPersonaName: persona.name,
    appliedFilters,
  };
}
