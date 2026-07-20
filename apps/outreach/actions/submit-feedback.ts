import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { feedback } from "../server/db/schema.js";

export default defineAction({
  description: "Submit feedback about the app with optional sentiment and written details.",
  schema: z.object({
    sentiment: z.enum(["positive", "negative"]).nullish(),
    message: z.string().min(1).max(2000),
  }),
  run: async ({ sentiment, message }, ctx) => {
    const db = getDb();
    await db.insert(feedback).values({
      id: nanoid(),
      userEmail: ctx?.userEmail ?? null,
      sentiment: sentiment ?? null,
      message,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  },
});
