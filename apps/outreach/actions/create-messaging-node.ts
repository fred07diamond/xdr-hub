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
  description: "Create a new typed messaging node on the canvas, owned by the current user. Pass content fields to populate the node in one call — avoids a follow-up update.",
  schema: z.object({
    nodeType: z.enum(["tone", "phrase_rule", "example", "role"]).default("tone"),
    title: z.string().min(1).max(120).optional(),
    positionX: z.number().int().default(300),
    positionY: z.number().int().default(300),
    tone: z.string().nullable().optional(),
    valueProps: z.string().nullable().optional(),
    phrasesToUse: z.string().nullable().optional(),
    phrasesToAvoid: z.string().nullable().optional(),
    exampleNotes: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  requiresAuth: true,
  run: async ({ nodeType, title: titleArg, positionX, positionY, tone, valueProps, phrasesToUse, phrasesToAvoid, exampleNotes, notes }, ctx) => {
    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const title = titleArg ?? DEFAULT_TITLES[nodeType] ?? "New Node";

    await db.insert(messagingNodes).values({
      id,
      type: nodeType,
      title,
      ownerEmail: ctx!.userEmail,
      positionX,
      positionY,
      tone: tone ?? null,
      valueProps: valueProps ?? null,
      phrasesToUse: phrasesToUse ?? null,
      phrasesToAvoid: phrasesToAvoid ?? null,
      exampleNotes: exampleNotes ?? null,
      notes: notes ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      type: nodeType,
      title,
      ownerEmail: ctx!.userEmail,
      personaId: null,
      tone: tone ?? null,
      valueProps: valueProps ?? null,
      phrasesToUse: phrasesToUse ?? null,
      phrasesToAvoid: phrasesToAvoid ?? null,
      exampleNotes: exampleNotes ?? null,
      notes: notes ?? null,
      positionX,
      positionY,
      createdAt: now,
      updatedAt: now,
    };
  },
});
