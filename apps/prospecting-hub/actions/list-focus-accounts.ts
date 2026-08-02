import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { focusAccounts } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List Focus Accounts visible to the caller — their own, plus every account if the caller is an admin.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const role = await getUserRole(ctx!.userEmail!);

    const whereClause = role === "admin" ? undefined : eq(focusAccounts.ownerEmail, ctx!.userEmail!);

    const rows = await db
      .select({
        id: focusAccounts.id,
        companyName: focusAccounts.companyName,
        companyDomain: focusAccounts.companyDomain,
        tier: focusAccounts.tier,
        ownerEmail: focusAccounts.ownerEmail,
        createdAt: focusAccounts.createdAt,
      })
      .from(focusAccounts)
      .where(whereClause)
      .orderBy(desc(focusAccounts.createdAt));

    return { focusAccounts: rows };
  },
});
