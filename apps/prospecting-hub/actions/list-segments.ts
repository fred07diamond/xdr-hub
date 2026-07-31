import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, or, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas, segmentContacts, segments } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List segments visible to the caller — owned or public, plus every segment if the caller is an admin — with contact counts and persona name/color.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const role = await getUserRole(ctx!.userEmail!);

    const notArchived = eq(segments.status, "active");
    const whereClause =
      role === "admin"
        ? notArchived
        : and(notArchived, or(eq(segments.ownerEmail, ctx!.userEmail!), eq(segments.visibility, "public")));

    const rows = await db
      .select({
        id: segments.id,
        name: segments.name,
        ownerEmail: segments.ownerEmail,
        assignedToEmail: segments.assignedToEmail,
        visibility: segments.visibility,
        personaId: segments.personaId,
        status: segments.status,
        lastRefreshedAt: segments.lastRefreshedAt,
        createdAt: segments.createdAt,
        personaName: personas.name,
        personaColor: personas.color,
      })
      .from(segments)
      .leftJoin(personas, eq(segments.personaId, personas.id))
      .where(whereClause)
      .orderBy(desc(segments.createdAt));

    if (rows.length === 0) return { segments: [] };

    const counts = await db
      .select({ segmentId: segmentContacts.segmentId, count: sql<number>`count(*)` })
      .from(segmentContacts)
      .where(inArray(segmentContacts.segmentId, rows.map((r) => r.id)))
      .groupBy(segmentContacts.segmentId);
    const countMap = new Map(counts.map((c) => [c.segmentId, Number(c.count)]));

    return {
      segments: rows.map((r) => ({ ...r, contactCount: countMap.get(r.id) ?? 0 })),
    };
  },
});
