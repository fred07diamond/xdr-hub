import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas } from "../server/db/schema.js";
import { encodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a core persona from an uploaded document's text content.",
  schema: z.object({
    name: z.string().min(1),
    color: z.string().min(1),
    description: z.string().nullish(),
    text: z.string().min(1).describe("The persona doc's full text content"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, color, description, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const id = nanoid();
    await db.insert(personas).values({
      id,
      name,
      color,
      description: description ?? null,
      criteria: encodePersonaCriteria(text),
      ownerEmail: ctx!.userEmail!,
      createdAt: new Date().toISOString(),
    });
    return { id };
  },
});
