import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts } from "../server/db/schema.js";
import { assertSegmentReadable } from "../server/helpers/segment-access.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Get a segment and its full contact list, if the caller can read it.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const segment = await assertSegmentReadable(id, ctx!.userEmail!, db);

    const contactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        company: contacts.company,
        email: contacts.email,
        personaMatchScore: contacts.personaMatchScore,
        companyFitScore: contacts.companyFitScore,
        scoreReasoning: contacts.scoreReasoning,
        status: contacts.status,
        linkedinUrl: contacts.linkedinUrl,
        hubspotUrl: contacts.hubspotUrl,
      })
      .from(segmentContacts)
      .innerJoin(contacts, eq(segmentContacts.contactId, contacts.id))
      .where(eq(segmentContacts.segmentId, id));

    return { segment, contacts: contactRows };
  },
});
