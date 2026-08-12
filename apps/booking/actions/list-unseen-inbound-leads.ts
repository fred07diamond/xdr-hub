import { defineAction } from "@agent-native/core";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

// The poll's own 3-day lookback is deliberately generous (catch-up safety
// net for a late/failed run) -- but the popup shouldn't keep nagging about
// something 2 days old just because nobody dismissed it yet. Leads outside
// this window still exist and are still dismissable; they just stop
// triggering the banner.
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export default defineAction({
  description: "List recent HubSpot Contact Sales leads not yet acknowledged by an XDR.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    // contactSalesDate (when the person actually submitted), NOT createdAt
    // (when our poll recorded it) -- a 3-day catch-up backlog all shares
    // today's createdAt regardless of which day each submission happened.
    // It's a plain "YYYY-MM-DD" string (HubSpot date-only property), so a
    // same-format cutoff string sorts/compares correctly.
    const cutoff = new Date(Date.now() - FRESHNESS_WINDOW_MS).toISOString().slice(0, 10);

    const db = getDb();
    const leads = await db
      .select()
      .from(inboundLeads)
      .where(and(eq(inboundLeads.seen, 0), gte(inboundLeads.contactSalesDate, cutoff)))
      .orderBy(desc(inboundLeads.createdAt));

    return { leads };
  },
});
