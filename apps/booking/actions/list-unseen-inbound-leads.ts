import { defineAction } from "@agent-native/core";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List HubSpot Contact Sales leads not yet acknowledged by an XDR.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    const leads = await db
      .select()
      .from(inboundLeads)
      .where(eq(inboundLeads.seen, 0))
      .orderBy(desc(inboundLeads.createdAt));

    return { leads };
  },
});
