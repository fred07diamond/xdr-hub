import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getSharedDb, sharedLibraryDocs } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a Sales Library document. Owner or admin only.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const sharedDb = getSharedDb();

    const existing = await sharedDb.select().from(sharedLibraryDocs).where(eq(sharedLibraryDocs.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Library doc ${id} not found.` };
    }
    if (existing[0].ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the document's owner or a manager can delete this." };
    }

    await sharedDb.delete(sharedLibraryDocs).where(eq(sharedLibraryDocs.id, id));

    return { ok: true };
  },
});
