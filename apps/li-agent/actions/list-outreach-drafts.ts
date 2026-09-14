import { defineAction } from "@agent-native/core";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { outreachDrafts } from "../server/db/schema.js";

export default defineAction({
  description: "Previously generated outreach drafts for one lead, so a panel can show what already exists without regenerating.",
  schema: z.object({
    source: z.enum(["lead_list_item", "prospect"]),
    id: z.string().min(1),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ source, id }) => {
    const rows = await getDb()
      .select()
      .from(outreachDrafts)
      .where(
        and(
          eq(outreachDrafts.subjectTable, source === "prospect" ? "prospects" : "lead_list_items"),
          eq(outreachDrafts.subjectId, id),
        ),
      )
      // Variant order, so three note options always read 1, 2, 3 rather than
      // shuffling between renders.
      .orderBy(asc(outreachDrafts.kind), asc(outreachDrafts.variantIndex));
    return { drafts: rows };
  },
});
