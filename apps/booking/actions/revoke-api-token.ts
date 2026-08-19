import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { apiTokens } from "../server/db/schema.js";

export default defineAction({
  description: "Revoke the current user's personal API token. get-api-token issues a fresh one on next read.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async (_args, ctx) => {
    const db = getDb();
    await db.delete(apiTokens).where(eq(apiTokens.userEmail, ctx!.userEmail));
    return { ok: true };
  },
});
