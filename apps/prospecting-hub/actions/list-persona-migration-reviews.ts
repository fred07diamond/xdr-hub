import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getSharedDb, personaMigrationReviews } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List the persona-migration review queue -- personas migrate-personas-to-shared.ts couldn't confidently auto-match (ambiguous name collisions or no counterpart on the other app) or that are still pending review.",
  schema: z.object({ status: z.enum(["pending", "confirmed_pair", "confirmed_separate"]).nullish() }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ status }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const sharedDb = getSharedDb();

    const rows = await sharedDb
      .select()
      .from(personaMigrationReviews)
      .where(status ? eq(personaMigrationReviews.status, status) : undefined)
      .orderBy(desc(personaMigrationReviews.createdAt));

    return { reviews: rows };
  },
});
