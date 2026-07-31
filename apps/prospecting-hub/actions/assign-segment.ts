import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { segments } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Assign a segment to an XDR/AE. Admin-only, regardless of who owns the segment.",
  schema: z.object({ id: z.string().min(1), assignedToEmail: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id, assignedToEmail }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();

    const existing = await db.select({ id: segments.id }).from(segments).where(eq(segments.id, id)).limit(1);
    if (!existing[0]) {
      throw Object.assign(new Error(`Segment ${id} not found.`), { statusCode: 404 });
    }

    await db.update(segments).set({ assignedToEmail }).where(eq(segments.id, id));

    return { id };
  },
});
