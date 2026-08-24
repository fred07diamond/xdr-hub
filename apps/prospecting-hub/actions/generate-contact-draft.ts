import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts } from "../server/db/schema.js";
import { generateAndPersistDraft } from "../server/helpers/draft-outreach.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Generate (or regenerate) an AI-drafted cold email (subject + body) and LinkedIn connection note for one contact, grounded in their matched persona's linked Sales Library docs and the single Customer Evidence proof point that persona's playbook authorizes. Persists draftEmailSubject/draftEmailBody/draftLinkedinMessage/draftGeneratedAt back onto the contact and returns them directly.",
  schema: z.object({ contactId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ contactId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const contactRows = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    const contact = contactRows[0];
    if (!contact) {
      throw Object.assign(new Error(`Contact ${contactId} not found.`), { statusCode: 404 });
    }

    // A contact with no assigned persona yet still gets a best-effort draft
    // using just its own fields and no persona-specific grounding — not yet
    // scored/matched is a legitimate state in this app, not a hard failure.
    let personaName: string | null = null;
    if (contact.personaId) {
      const personaRows = await getSharedDb()
        .select({ name: sharedPersonas.name })
        .from(sharedPersonas)
        .where(eq(sharedPersonas.id, contact.personaId))
        .limit(1);
      personaName = personaRows[0]?.name ?? null;
    }

    const draft = await generateAndPersistDraft({
      contact: {
        id: contact.id,
        name: contact.name,
        title: contact.title,
        company: contact.company,
        scoreReasoning: contact.scoreReasoning,
        personaId: contact.personaId,
      },
      personaName,
      userEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
    });

    return { contactId, ...draft };
  },
});
