import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getSharedDb, personaMigrationReviews } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

// Bookkeeping/audit only -- does NOT automatically merge the two already-
// created standalone shared persona records a "confirmed_pair" resolution
// implies should really be one. migrate-personas-to-shared.ts always
// creates a real, working shared record for every persona up front
// (nothing is ever left unusable pending review), so resolving a row here
// just closes out the admin's review checklist; an admin who confirms two
// records really are the same persona is expected to consolidate them by
// hand (e.g. moving/re-linking usages, then deleting the redundant one) --
// a real data merge across a persona's docs, briefing, and every consumer
// that already points at it deserves deliberate handling, not one click.
export default defineAction({
  description:
    "Mark one persona-migration review row confirmed (as a real pair to reconcile manually, or as genuinely separate personas). Audit/checklist only -- does not merge any data.",
  schema: z.object({ id: z.string().min(1), resolution: z.enum(["confirmed_pair", "confirmed_separate"]) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, resolution }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select().from(personaMigrationReviews).where(eq(personaMigrationReviews.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Review ${id} not found.` };
    }

    await sharedDb
      .update(personaMigrationReviews)
      .set({ status: resolution, resolvedAt: new Date().toISOString() })
      .where(eq(personaMigrationReviews.id, id));

    return { ok: true };
  },
});
