import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
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

export default defineAction({
  description:
    "Search distinct company names already synced from HubSpot (via existing HubSpot-sourced contacts), for company-picker autocomplete UI. No live HubSpot API call — reads from this app's own synced contact pool.",
  schema: z.object({ query: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ query }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const pattern = `%${escapeLikePattern(query.trim())}%`;
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

    return { companies };
  },
});
