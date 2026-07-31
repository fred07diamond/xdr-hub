import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchGoogleDocText } from "../server/helpers/google-drive-client.js";
import { upsertPersonaFromDoc } from "../server/helpers/persona-sync.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Sync a core persona's criteria from a native Google Doc. Re-syncing the same doc URL updates that persona; a new URL requires a name and creates one. Requires Google Drive connected in Settings.",
  schema: z.object({
    docUrl: z.string().min(1).describe("Google Docs URL or raw file id"),
    name: z.string().nullish().describe("Persona name — required the first time this doc is synced"),
    description: z.string().nullish(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ docUrl, name, description }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);
    const rawText = await fetchGoogleDocText(docUrl, ctx!.userEmail!);
    const { personaId, created } = await upsertPersonaFromDoc({
      sourceDocUrl: docUrl,
      rawText,
      ownerEmail: ctx!.userEmail!,
      name: name ?? undefined,
      description: description ?? undefined,
    });
    return { personaId, created, charsSynced: rawText.length };
  },
});
