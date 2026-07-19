import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpSources } from "../server/db/schema.js";

export default defineAction({
  description:
    "Return the currently selected Notion page IDs and titles used as ICP context for drafting.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const db = getDb();
    const row = await db
      .select({
        sources: icpSources.sources,
        icpText: icpSources.icpText,
        updatedAt: icpSources.updatedAt,
      })
      .from(icpSources)
      .where(eq(icpSources.id, "singleton"))
      .limit(1);

    const sources = row[0]?.sources
      ? (JSON.parse(row[0].sources) as Array<{ id: string; title: string }>)
      : [];
    const icpText = row[0]?.icpText ?? null;
    const updatedAt = row[0]?.updatedAt ?? null;

    return { sources, icpText, updatedAt };
  },
});
