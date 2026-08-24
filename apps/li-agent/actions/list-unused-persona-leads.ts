import { defineAction } from "@agent-native/core";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, prospects } from "../server/db/schema.js";

// Cross-app read for prospecting-hub's prospect-pull-plan reconcile step
// (Phase 5 of the alignment roadmap) -- called via
// @agent-native/core/a2a's invokeAgentAction(), never from within li-agent
// itself. li-agent stays the sole owner of its own lead data: this is a
// read only, no write-back/"claiming" of returned leads (prospecting-hub
// dedupes on its own side by externalId, same as any other source).
//
// "Not yet actioned" is promotedProspectId IS NULL -- leadListItems.status
// (pending/visited/skipped) is a vestigial column the product deliberately
// stopped using for workflow, see CLAUDE.md's Lead Lists section.
//
// ownerEmail comes from ctx.userEmail, populated by the framework from the
// A2A call's verified JWT `sub` claim -- the same identity resolution every
// other signed-in li-agent action already relies on, not a separate param.
export default defineAction({
  description:
    "List this rep's captured-but-not-yet-actioned LinkedIn leads for one persona (id from li-agent's own icpPersonas table) -- leads already imported via the Chrome extension, never a live LinkedIn pull. Read-only; the caller is responsible for its own dedup on repeated calls.",
  schema: z.object({
    personaId: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  requiresAuth: true,
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: { method: "GET" },
  run: async ({ personaId, limit }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { leads: [] };

    const db = getDb();

    // Same dedup discipline as list-all-prospects.ts: a lead whose
    // profileUrl already matches an existing prospects row for this owner
    // has a richer record elsewhere and shouldn't be handed out again.
    const ownedProspectUrls = await db
      .select({ profileUrl: prospects.profileUrl })
      .from(prospects)
      .where(eq(prospects.ownerEmail, userEmail));
    const excludedUrls = ownedProspectUrls.map((p) => p.profileUrl).filter((u): u is string => !!u);

    const rows = await db
      .select({
        id: leadListItems.id,
        name: leadListItems.name,
        headline: leadListItems.headline,
        company: leadListItems.company,
        location: leadListItems.location,
        profileUrl: leadListItems.profileUrl,
        salesNavLeadUrl: leadListItems.salesNavLeadUrl,
      })
      .from(leadListItems)
      .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
      .where(
        and(
          eq(leadLists.ownerEmail, userEmail),
          eq(leadListItems.personaId, personaId),
          isNull(leadListItems.promotedProspectId),
          excludedUrls.length > 0 ? notInArray(leadListItems.profileUrl, excludedUrls) : undefined,
        ),
      )
      .limit(limit);

    return {
      leads: rows.map((r) => ({
        // Stable identifier for the caller's own dedup on repeated calls --
        // profileUrl is null until the xDR opens the lead's real profile, so
        // it can't be relied on as always-present.
        id: r.id,
        name: r.name,
        title: r.headline,
        company: r.company,
        location: r.location,
        linkedinUrl: r.profileUrl ?? r.salesNavLeadUrl,
      })),
    };
  },
});
