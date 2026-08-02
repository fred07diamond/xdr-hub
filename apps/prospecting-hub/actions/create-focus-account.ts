import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { focusAccounts } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a Focus Account — a target company for the caller's own list, used to scope CommonRoom Prospector searches.",
  schema: z.object({
    companyName: z.string().min(1),
    companyDomain: z.string().nullish(),
    tier: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ companyName, companyDomain, tier }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const id = nanoid();
    await db.insert(focusAccounts).values({
      id,
      ownerEmail: ctx!.userEmail!,
      companyName,
      companyDomain: companyDomain ?? null,
      tier: tier ?? null,
      createdAt: new Date().toISOString(),
    });
    return { id };
  },
});
