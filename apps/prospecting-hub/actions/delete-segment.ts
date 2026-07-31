import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { segmentContacts, segments } from "../server/db/schema.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

export default defineAction({
  description: "Delete a segment and its contact memberships. Owner or admin only.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const db = getDb();
    await assertSegmentWritable(id, ctx!.userEmail!, db);

    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, id));
    await db.delete(segments).where(eq(segments.id, id));

    return { ok: true };
  },
});
