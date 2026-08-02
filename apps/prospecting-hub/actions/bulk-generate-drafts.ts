import { defineAction } from "@agent-native/core";
import { inArray } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas } from "../server/db/schema.js";
import { generateAndPersistDraft } from "../server/helpers/draft-outreach.js";
import { requireRole } from "../server/helpers/require-role.js";

// Cap matches rescore-contacts.ts's MAX_CONTACTS_PER_RUN convention.
const MAX_CONTACTS_PER_RUN = 200;

export default defineAction({
  description:
    "Generate (or regenerate) AI-drafted outreach (cold email + LinkedIn note) for a batch of contacts, up to 200 per run. Each contact is processed independently — one failure doesn't affect the rest.",
  schema: z.object({
    contactIds: z.array(z.string().min(1)).min(1).max(MAX_CONTACTS_PER_RUN),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ contactIds }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const targets = await db
      .select()
      .from(contacts)
      .where(inArray(contacts.id, contactIds))
      .limit(MAX_CONTACTS_PER_RUN);

    const personaRows = await db.select({ id: personas.id, name: personas.name }).from(personas);
    const personaNameById = new Map(personaRows.map((p) => [p.id, p.name]));

    let generated = 0;
    const errors: string[] = [];

    // Sequential, NOT Promise.all — mirrors rescore-contacts.ts's per-item
    // try/catch resilience so one bad contact (e.g. an unparseable model
    // response) never affects the rest of the batch.
    for (const contact of targets) {
      try {
        await generateAndPersistDraft({
          contact: {
            id: contact.id,
            name: contact.name,
            title: contact.title,
            company: contact.company,
            scoreReasoning: contact.scoreReasoning,
            personaId: contact.personaId,
          },
          personaName: contact.personaId ? (personaNameById.get(contact.personaId) ?? null) : null,
          userEmail: ctx!.userEmail!,
          orgId: ctx?.orgId,
        });
        generated++;
      } catch (err) {
        errors.push(`${contact.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { generated, attempted: targets.length, errors };
  },
});
