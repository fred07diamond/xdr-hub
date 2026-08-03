import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { hubspotFetchIfConnected } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts } from "../server/db/schema.js";
import { escapeLikePattern } from "../server/helpers/normalize-linkedin-url.js";
import { requireRole } from "../server/helpers/require-role.js";

const MAX_RESULTS = 20;
// Over-fetch before de-duping in JS rather than a SQL-level DISTINCT — this
// app has no existing precedent for selectDistinct() and no confirmed
// cross-dialect (SQLite/Postgres) support for it via this framework's db
// wrapper, whereas a plain filtered SELECT + JS-side Set dedup is provably
// portable. Company-name cardinality here is small (one org's synced
// HubSpot contacts), so over-fetching this many rows before deduping is
// cheap.
const RAW_FETCH_LIMIT = 200;

interface HubSpotCompanySearchResult {
  results?: Array<{ properties?: { name?: string } }>;
}

// Fallback used only when the live HubSpot search is unavailable or errors
// (not connected, expired token, transient API failure) — searches company
// names already present on this app's own HubSpot-sourced contacts. Always
// a strict subset of what live HubSpot search would return (every synced
// contact's company IS a real HubSpot company), so this only ever narrows
// the picker, never contradicts it.
async function searchLocallySyncedCompanies(query: string): Promise<string[]> {
  const db = getDb();
  const pattern = `%${escapeLikePattern(query)}%`;
  const rows = await db
    .select({ company: contacts.company })
    .from(contacts)
    .where(and(eq(contacts.source, "hubspot"), sql`LOWER(${contacts.company}) LIKE LOWER(${pattern}) ESCAPE '\\'`))
    .orderBy(contacts.company)
    .limit(RAW_FETCH_LIMIT);

  const seen = new Set<string>();
  const companies: string[] = [];
  for (const row of rows) {
    if (!row.company) continue;
    const key = row.company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(row.company);
    if (companies.length >= MAX_RESULTS) break;
  }
  return companies;
}

export default defineAction({
  description:
    "Search HubSpot companies by name (live API call) for company-picker autocomplete UI, so an XDR can pick a real HubSpot company even if it has no synced contact yet. Falls back to searching this app's own already-synced HubSpot contacts' company names if HubSpot isn't connected or the live call fails.",
  schema: z.object({ query: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ query }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const trimmed = query.trim();

    try {
      // HubSpot's CONTAINS_TOKEN operator matches whole tokens by default;
      // wrapping the value in "*"s makes it match substrings within a token
      // too (e.g. "sty" matching "ShopStyle"), same wildcard convention
      // HubSpot's own docs describe for this operator.
      const connected = await hubspotFetchIfConnected("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: `*${trimmed}*` }] }],
          properties: ["name"],
          limit: MAX_RESULTS,
        }),
      });
      if (connected) {
        const parsed = connected.data as HubSpotCompanySearchResult;
        const seen = new Set<string>();
        const companies: string[] = [];
        for (const r of parsed.results ?? []) {
          const name = r.properties?.name;
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          companies.push(name);
        }
        return { companies };
      }
    } catch {
      // Live HubSpot search failed (transient API error, unexpected filter
      // shape, etc.) — fall through to the local fallback below rather than
      // erroring the whole picker out from under the user.
    }

    return { companies: await searchLocallySyncedCompanies(trimmed) };
  },
});
