import { defineAction } from "@agent-native/core";
import { eq, and } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, syncRecords } from "../server/db/schema.js";
import { commonroomListContactsInSegment, type CommonRoomContact } from "../server/helpers/commonroom-client.js";
import { requireRole } from "../server/helpers/require-role.js";

// Hard cap per run, same reasoning as sync-hubspot.ts's MAX_CONTACTS_PER_RUN.
const MAX_CONTACTS_PER_RUN = 1000;
const PAGE_SIZE = 50;

export default defineAction({
  description: "Pull contacts from a CommonRoom segment into the local contact pool (read-only). Paginates up to a hard cap per run.",
  schema: z.object({
    segmentId: z.string().min(1).describe("CommonRoom segment id, e.g. s_14798643 — use list-commonroom-segments to find it"),
    limit: z.number().int().min(1).max(MAX_CONTACTS_PER_RUN).default(500),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ segmentId, limit }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const syncId = nanoid();
    const startedAt = new Date().toISOString();

    await db.insert(syncRecords).values({
      id: syncId,
      source: "commonroom",
      startedAt,
      status: "running",
    });

    try {
      const pulled: CommonRoomContact[] = [];
      let cursor: string | undefined;
      while (pulled.length < limit) {
        const pageSize = Math.min(PAGE_SIZE, limit - pulled.length);
        const page = await commonroomListContactsInSegment({ orgId: ctx?.orgId, segmentId, limit: pageSize, cursor });
        pulled.push(...page.records);

        cursor = page.nextCursor;
        if (!page.has_more || !cursor) break;
      }

      const now = new Date().toISOString();
      let created = 0;
      let updated = 0;

      for (const crContact of pulled) {
        const name = (crContact.name ?? "").trim();
        if (!name) continue; // skip contacts with no name at all — nothing useful to sort

        const existing = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.externalId, crContact.id), eq(contacts.source, "commonroom")))
          .limit(1);

        if (existing[0]) {
          await db
            .update(contacts)
            .set({
              name,
              title: crContact.title ?? null,
              company: crContact.companyName ?? null,
              email: crContact.primaryEmail ?? null,
              syncedAt: now,
              updatedAt: now,
            })
            .where(eq(contacts.id, existing[0].id));
          updated++;
        } else {
          await db.insert(contacts).values({
            id: nanoid(),
            name,
            title: crContact.title ?? null,
            company: crContact.companyName ?? null,
            email: crContact.primaryEmail ?? null,
            source: "commonroom",
            externalId: crContact.id,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          created++;
        }
      }

      await db
        .update(syncRecords)
        .set({ status: "success", completedAt: new Date().toISOString(), recordsPulled: pulled.length })
        .where(eq(syncRecords.id, syncId));

      return { syncId, status: "success" as const, recordsPulled: pulled.length, created, updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(syncRecords)
        .set({ status: "failed", completedAt: new Date().toISOString(), error: message })
        .where(eq(syncRecords.id, syncId));
      throw Object.assign(new Error(`CommonRoom sync failed: ${message}`), { statusCode: 502 });
    }
  },
});
