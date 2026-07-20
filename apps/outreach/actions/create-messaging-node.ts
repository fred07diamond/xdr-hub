import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";

export default defineAction({
  description: "Create a new user messaging node on the canvas.",
  schema: z.object({
    positionX: z.number().int().default(300),
    positionY: z.number().int().default(300),
  }),
  requiresAuth: true,
  run: async ({ positionX, positionY }) => {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();

    await db.insert(messagingNodes).values({
      id,
      type: "user",
      title: "New Node",
      positionX,
      positionY,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      type: "user",
      title: "New Node",
      personaId: null,
      tone: null,
      valueProps: null,
      phrasesToUse: null,
      phrasesToAvoid: null,
      exampleNotes: null,
      notes: null,
      positionX,
      positionY,
      createdAt: now,
      updatedAt: now,
    };
  },
});
