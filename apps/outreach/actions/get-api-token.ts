import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { apiTokens } from "../server/db/schema.js";

export default defineAction({
  description: "Return the current user's personal API token, creating one if it doesn't exist. Used to authenticate the Chrome extension.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) throw new Error("Authentication required");
    const db = getDb();

    const existing = await db
      .select({ token: apiTokens.token })
      .from(apiTokens)
      .where(eq(apiTokens.userEmail, ctx.userEmail))
      .limit(1);

    if (existing[0]) return { token: existing[0].token };

    const token = nanoid(32);
    await db.insert(apiTokens).values({
      id: nanoid(),
      userEmail: ctx.userEmail,
      token,
    });

    return { token };
  },
});
