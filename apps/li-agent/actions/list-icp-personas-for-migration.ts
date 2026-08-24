import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

// One-time read for prospecting-hub's migrate-personas-to-shared.ts (see
// the cross-app shared-personas plan) -- called via A2A's
// invokeAgentAction(). Returns the FULL org-wide persona catalog with docs,
// not scoped to the calling rep, since a migration needs to see everything
// to auto-match by name; admin-gated for exactly that reason (this is a
// wider read than any other A2A action this app exposes).
export default defineAction({
  description:
    "Admin-only: list every ICP persona and its documents, for one-time migration into the shared cross-app personas table. Not scoped to the caller's own data.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireAdmin(ctx);
    const db = getDb();

    const personas = await db.select().from(icpPersonas);
    const docs = await db.select().from(icpPersonaDocs).orderBy(asc(icpPersonaDocs.sortOrder), asc(icpPersonaDocs.createdAt));

    const docsByPersona = new Map<string, typeof docs>();
    for (const doc of docs) {
      const list = docsByPersona.get(doc.personaId) ?? [];
      list.push(doc);
      docsByPersona.set(doc.personaId, list);
    }

    return {
      personas: personas.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isActive: p.isActive,
        summary: p.summary,
        briefing: p.briefing,
        briefingGeneratedAt: p.briefingGeneratedAt,
        briefingSourceHash: p.briefingSourceHash,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        docs: (docsByPersona.get(p.id) ?? []).map((d) => ({
          fileName: d.name,
          content: d.text,
          wordCount: d.wordCount,
          sortOrder: d.sortOrder,
        })),
      })),
    };
  },
});
