import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { focusAccounts } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete a Focus Account. Only its owner or an admin may delete it.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(focusAccounts).where(eq(focusAccounts.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Focus account ${id} not found.` };
    }

    if (existing[0].ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the focus account's owner or an admin can delete this." };
    }

    await db.delete(focusAccounts).where(eq(focusAccounts.id, id));

    return { ok: true };
  },
});
