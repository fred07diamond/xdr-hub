import { defineAction } from "@agent-native/core";
import { and, eq } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, segments } from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Mark a contact as actioned and add it to the caller's personal 'Actioned' segment (created on first use).",
  schema: z.object({ contactId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ contactId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const existingContact = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!existingContact[0]) {
      throw Object.assign(new Error(`Contact ${contactId} not found.`), { statusCode: 404 });
    }

    const now = new Date().toISOString();
    await db.update(contacts).set({ status: "actioned", updatedAt: now }).where(eq(contacts.id, contactId));

    const existingSegment = await db
      .select({ id: segments.id })
      .from(segments)
      .where(and(eq(segments.ownerEmail, userEmail), eq(segments.name, "Actioned")))
      .limit(1);

    let actionedSegmentId: string;
    if (existingSegment[0]) {
      actionedSegmentId = existingSegment[0].id;
    } else {
      actionedSegmentId = nanoid();
      await db.insert(segments).values({
        id: actionedSegmentId,
        name: "Actioned",
        ownerEmail: userEmail,
        visibility: "private",
        personaId: null,
        filters: null,
        status: "active",
        createdAt: now,
      });
    }

    const existingLink = await db
      .select({ id: segmentContacts.id })
      .from(segmentContacts)
      .where(and(eq(segmentContacts.segmentId, actionedSegmentId), eq(segmentContacts.contactId, contactId)))
      .limit(1);
    if (!existingLink[0]) {
      await db.insert(segmentContacts).values({ id: nanoid(), segmentId: actionedSegmentId, contactId });
    }

    await logAnalyticsEvent(userEmail, "contact_actioned", { contactId });

    return { contactId, actionedSegmentId };
  },
});
