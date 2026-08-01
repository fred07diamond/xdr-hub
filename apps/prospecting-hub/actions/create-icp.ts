import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps } from "../server/db/schema.js";
import { encodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create an ICP (Ideal Customer Profile) — company-level qualification criteria — from an uploaded document's text content.",
  schema: z.object({
    name: z.string().min(1),
    color: z.string().min(1),
    product: z.string().nullish(),
    text: z.string().min(1).describe("The ICP doc's full text content"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, color, product, text }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const db = getDb();
    const id = nanoid();
    await db.insert(icps).values({
      id,
      name,
      color,
      product: product ?? null,
      criteria: encodePersonaCriteria(text),
      ownerEmail: ctx!.userEmail!,
      createdAt: new Date().toISOString(),
    });
    return { id };
  },
});
