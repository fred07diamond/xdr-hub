import { defineAction } from "@agent-native/core";
import { desc } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icps } from "../server/db/schema.js";
import { decodePersonaCriteria } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List ICPs (Ideal Customer Profiles) with name, product, color, and a word count derived from their synced document text.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const rows = await db
      .select({
        id: icps.id,
        name: icps.name,
        product: icps.product,
        color: icps.color,
        sourceDocUrl: icps.sourceDocUrl,
        criteria: icps.criteria,
        ownerEmail: icps.ownerEmail,
        createdAt: icps.createdAt,
      })
      .from(icps)
      .orderBy(desc(icps.createdAt));

    return {
      icps: rows.map((p) => {
        const rawText = decodePersonaCriteria(p.criteria);
        return {
          id: p.id,
          name: p.name,
          product: p.product,
          color: p.color,
          sourceDocUrl: p.sourceDocUrl,
          wordCount: rawText ? rawText.split(/\s+/).filter(Boolean).length : 0,
          ownerEmail: p.ownerEmail,
          createdAt: p.createdAt,
        };
      }),
    };
  },
});
