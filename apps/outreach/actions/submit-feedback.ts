import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { feedback } from "../server/db/schema.js";

export default defineAction({
  description: "Submit a free-text feedback message about the app.",
  schema: z.object({
    message: z.string().min(1).max(2000),
  }),
  run: async ({ message }, ctx) => {
    const db = getDb();
    await db.insert(feedback).values({
      id: nanoid(),
      userEmail: ctx?.userEmail ?? null,
      message,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  },
});
