import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchNotionPageText } from "../server/helpers/notion-client.js";
import { upsertSharedPersonaFromDoc } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Sync a core persona's criteria from a Notion page. Re-syncing the same page URL updates that persona; a new URL requires a name and creates one.",
  schema: z.object({
    docUrl: z.string().min(1).describe("Notion page URL or raw page id"),
    name: z.string().nullish().describe("Persona name — required the first time this doc is synced"),
    description: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ docUrl, name, description }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const rawText = await fetchNotionPageText(docUrl);
    const { personaId, created } = await upsertSharedPersonaFromDoc({
      sourceDocUrl: docUrl,
      rawText,
      ownerEmail: ctx!.userEmail!,
      name: name ?? undefined,
      description: description ?? undefined,
    });
    return { personaId, created, charsSynced: rawText.length };
  },
});
