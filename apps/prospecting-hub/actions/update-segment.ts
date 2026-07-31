import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { segments } from "../server/db/schema.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

export default defineAction({
  description: "Rename a segment or change its visibility. Owner or admin only.",
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).nullish(),
    visibility: z.enum(["private", "public"]).nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, name, visibility }, ctx) => {
    const db = getDb();
    await assertSegmentWritable(id, ctx!.userEmail!, db);

    await db
      .update(segments)
      .set({
        ...(name ? { name } : {}),
        ...(visibility ? { visibility } : {}),
      })
      .where(eq(segments.id, id));

    return { id };
  },
});
