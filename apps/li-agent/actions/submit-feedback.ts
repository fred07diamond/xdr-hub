import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { feedback } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "Submit feedback about a draft note with optional sentiment, written details, and the draft that was rated.",
  schema: z.object({
    sentiment: z.enum(["positive", "negative"]).nullish(),
    message: z.string().max(2000).nullish(),
    draftNote: z.string().max(500).nullish(),
    apiToken: z.string().nullish(),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async ({ sentiment, message, draftNote, apiToken }, ctx) => {
    const userEmail = await resolveOwner(apiToken, ctx);
    const db = getDb();
    await db.insert(feedback).values({
      id: nanoid(),
      userEmail,
      sentiment: sentiment ?? null,
      message: message?.trim() || "",
      draftNote: draftNote?.trim() || null,
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  },
});
