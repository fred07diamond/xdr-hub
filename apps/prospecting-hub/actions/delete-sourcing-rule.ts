import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath } from "@agent-native/core/resources";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { sourcingRules } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Delete a sourcing rule and stop its scheduled runs. Owner or admin only. Does NOT delete the rule's segment or its accumulated contacts — that data stays.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(sourcingRules).where(eq(sourcingRules.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Sourcing rule ${id} not found.` };
    }
    const rule = existing[0];

    if (rule.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the sourcing rule's owner or a manager can delete this." };
    }

    if (rule.jobResourcePath) {
      await resourceDeleteByPath(rule.ownerEmail, rule.jobResourcePath);
    }
    await db.delete(sourcingRules).where(eq(sourcingRules.id, id));

    return { ok: true };
  },
});
