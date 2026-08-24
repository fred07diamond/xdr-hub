import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { resourceDeleteByPath } from "@agent-native/core/resources";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospectPullPlans } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Delete a prospect pull plan and stop its reconcile schedule. Owner or admin only. Does NOT delete the persona sourcing/marketing rules it created — those keep running as ordinary standalone rules, mirroring delete-sourcing-rule.ts's own choice to leave accumulated data alone.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const existing = await db.select().from(prospectPullPlans).where(eq(prospectPullPlans.id, id)).limit(1);
    if (!existing[0]) {
      return { ok: false, error: `Prospect pull plan ${id} not found.` };
    }
    const plan = existing[0];

    if (plan.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      return { ok: false, error: "Only the plan's owner or a manager can delete this." };
    }

    if (plan.jobResourcePath) {
      await resourceDeleteByPath(plan.ownerEmail, plan.jobResourcePath);
    }
    await db.delete(prospectPullPlans).where(eq(prospectPullPlans.id, id));

    return { ok: true };
  },
});
