import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";

const DEFAULT_TITLES: Record<string, string> = {
  tone: "Tone & Voice",
  phrase_rule: "Phrase Rule",
  example: "Example Note",
  role: "Role Targeting",
};

export default defineAction({
  description: "Create a new typed messaging node on the canvas.",
  schema: z.object({
    nodeType: z.enum(["tone", "phrase_rule", "example", "role"]).default("tone"),
    positionX: z.number().int().default(300),
    positionY: z.number().int().default(300),
  }),
  requiresAuth: true,
  run: async ({ nodeType, positionX, positionY }) => {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const title = DEFAULT_TITLES[nodeType] ?? "New Node";

    await db.insert(messagingNodes).values({
      id,
      type: nodeType,
      title,
      positionX,
      positionY,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      type: nodeType,
      title,
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
