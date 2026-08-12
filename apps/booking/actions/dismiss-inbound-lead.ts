import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Mark a HubSpot Contact Sales lead as acknowledged so it stops popping up.",
  schema: z.object({ leadId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ leadId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    await db.update(inboundLeads).set({ seen: 1 }).where(eq(inboundLeads.id, leadId));

    return { ok: true };
  },
});
