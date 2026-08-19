import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems } from "../server/db/schema.js";
import { scoreLeadListItem } from "../server/helpers/score-lead-list-item.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

// Generates a real ICP fit score + draft connection note for a Sales Nav
// lead list item that hasn't been visited yet -- normally this only happens
// via capture-profile.ts when a rep opens the actual LinkedIn profile page
// (see CLAUDE.md's Lead Lists section). This is a deliberate, separate,
// user-triggered action so enrich-lead-list-item.ts (Apollo data lookup)
// stays exactly what it always was everywhere it's used -- a data lookup,
// not a fit judgment. Reuses the exact same scoring/drafting helpers
// capture-profile.ts calls, just fed from the lead list item's own fields
// instead of a live page scrape -- there's no "About" or "recent activity"
// for someone who hasn't been visited, so those stay null, same as
// capture-profile does when the extension doesn't send them.
export default defineAction({
  description: "Score ICP fit and draft a connection note for a not-yet-visited Sales Navigator lead list item, promoting it into a real prospect row.",
  schema: z.object({ itemId: z.string() }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ itemId }, ctx) => {
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const itemRows = await db.select().from(leadListItems).where(eq(leadListItems.id, itemId));
    const item = itemRows[0];
    if (!item) return { ok: false, error: "Lead not found." };
    const listRows = await db.select().from(leadLists).where(eq(leadLists.id, item.listId));
    if (!listRows[0] || listRows[0].ownerEmail !== userEmail) return { ok: false, error: "Not authorized." };

    // Raised from 60/hr (which matched capture-profile.ts's single-profile-
    // visit pattern) -- live-confirmed this was actively blocking real usage:
    // Score & Draft gets run in bulk across a freshly-imported list in one
    // sitting, the same "~500 leads/day" pattern enrich-lead-list-item.ts
    // was raised for, not a slow trickle of one-at-a-time profile visits.
    if (!(await checkRateLimit(userEmail, "score-lead-list-item", 500))) {
      return { ok: false, error: "Rate limit reached -- try again shortly." };
    }
    // Deliberately no isOverDailyLimit check here, unlike capture-profile.ts.
    // That cap paces actual SENT outreach volume -- but this action only
    // prepares a draft; a human still has to review it and click "Mark sent"
    // separately (the same as any other prospect). Gating bulk drafting
    // behind a daily send-pacing cap would trip on the very first batch of
    // a freshly-imported list, defeating the point of a bulk-drafting
    // feature -- live-confirmed this exact failure mode on real usage.

    return scoreLeadListItem(db, item, userEmail);
  },
});
