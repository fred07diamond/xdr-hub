import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { libraryDocs } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a Sales Library document. Owner or admin only.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(libraryDocs).where(eq(libraryDocs.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Library doc ${id} not found.` };
    }
    if (existing[0].ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the document's owner or a manager can delete this." };
    }

    await db.delete(libraryDocs).where(eq(libraryDocs.id, id));

    return { ok: true };
  },
});
