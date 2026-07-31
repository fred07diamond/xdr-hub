import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, segments } from "../server/db/schema.js";
import { assertSegmentWritable } from "../server/helpers/segment-access.js";

export default defineAction({
  description: "Re-run a segment's stored persona/score filter and refresh its contact membership to match current data.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const db = getDb();
    const { segment } = await assertSegmentWritable(id, ctx!.userEmail!, db);

    const filters = segment.filters
      ? (JSON.parse(segment.filters) as { personaId?: string; minPersonaMatchScore?: number })
      : null;
    if (!filters?.personaId) {
      throw Object.assign(
        new Error("This segment has no generation filters to refresh (it's manually curated)."),
        { statusCode: 400 },
      );
    }

    await db.delete(segmentContacts).where(eq(segmentContacts.segmentId, id));

    const matches = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.personaId, filters.personaId),
          sql`${contacts.personaMatchScore} >= ${filters.minPersonaMatchScore ?? 50}`,
          eq(contacts.status, "active"),
        ),
      );

    for (const contact of matches) {
      await db.insert(segmentContacts).values({ id: nanoid(), segmentId: id, contactId: contact.id });
    }

    await db
      .update(segments)
      .set({ lastRefreshedAt: new Date().toISOString() })
      .where(eq(segments.id, id));

    return { id, contactCount: matches.length };
  },
});
