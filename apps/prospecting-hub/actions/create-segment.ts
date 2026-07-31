import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, segments } from "../server/db/schema.js";
import { logAnalyticsEvent } from "../server/helpers/analytics.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Create a segment from a persona and minimum match score, populating it with all currently-matching active contacts.",
  schema: z.object({
    name: z.string().min(1),
    personaId: z.string().min(1),
    minPersonaMatchScore: z.number().int().min(0).max(100).default(50),
    visibility: z.enum(["private", "public"]).default("private"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ name, personaId, minPersonaMatchScore, visibility }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const segmentId = nanoid();
    const now = new Date().toISOString();
    await db.insert(segments).values({
      id: segmentId,
      name,
      ownerEmail: ctx!.userEmail!,
      personaId,
      visibility,
      status: "active",
      filters: JSON.stringify({ personaId, minPersonaMatchScore }),
      lastRefreshedAt: now,
      createdAt: now,
    });

    const matches = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.personaId, personaId),
          sql`${contacts.personaMatchScore} >= ${minPersonaMatchScore}`,
          eq(contacts.status, "active"),
        ),
      );

    for (const contact of matches) {
      await db.insert(segmentContacts).values({ id: nanoid(), segmentId, contactId: contact.id });
    }

    await logAnalyticsEvent(ctx!.userEmail!, "segment_created", {
      segmentId,
      personaId,
      contactCount: matches.length,
    });

    return { id: segmentId, contactCount: matches.length };
  },
});
