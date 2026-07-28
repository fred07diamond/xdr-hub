import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas } from "../server/db/schema.js";

export default defineAction({
  description: "List all ICP personas ordered by creation date.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: icpPersonas.id,
        name: icpPersonas.name,
        color: icpPersonas.color,
        icpText: icpPersonas.icpText,
        summary: icpPersonas.summary,
        isActive: icpPersonas.isActive,
        createdAt: icpPersonas.createdAt,
        updatedAt: icpPersonas.updatedAt,
      })
      .from(icpPersonas)
      .orderBy(asc(icpPersonas.createdAt));

    return {
      personas: rows.map((r) => ({
        ...r,
        wordCount: r.icpText
          ? r.icpText.split(/\s+/).filter(Boolean).length
          : 0,
        icpText: undefined,
      })),
    };
  },
});
