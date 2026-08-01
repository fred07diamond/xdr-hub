import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Delete an ICP. Does not cascade-delete any sourcing rule that references it — the rule simply keeps a dangling icpId (a future pipeline concern, not this action's).",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();

    const existing = await db.select({ id: icps.id }).from(icps).where(eq(icps.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `ICP ${id} not found.` };
    }

    await db.delete(icps).where(eq(icps.id, id));

    return { ok: true };
  },
});
