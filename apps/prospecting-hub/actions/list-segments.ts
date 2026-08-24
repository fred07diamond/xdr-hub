import { defineAction } from "@agent-native/core";
import { and, desc, eq, inArray, or, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { marketingRules, segmentContacts, segments, sourcingRules } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List segments (\"Lists\") visible to the caller — owned or public, plus every segment if the caller is an admin — with contact counts, persona name/color, and its kind: \"prospected\" (auto-populated by a CommonRoom-Prospector rule), \"marketing\" (auto-populated by a HubSpot-lifecycle-stage rule), or \"static\" (manually curated).",
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

    // LEFT JOIN both rule tables the reverse direction of list-sourcing-
    // rules.ts/list-marketing-rules.ts's own joins: each rule owns exactly
    // one segment (1:1 via <table>.segmentId), so each join returns at most
    // one rule row per segment — whichever one is present (never both, by
    // construction — a segment is created by exactly one rule-creation
    // action) determines the list's kind.
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
        sourcingRuleId: sourcingRules.id,
        marketingRuleId: marketingRules.id,
      })
      .from(segments)
      .leftJoin(sourcingRules, eq(sourcingRules.segmentId, segments.id))
      .leftJoin(marketingRules, eq(marketingRules.segmentId, segments.id))
      .where(whereClause)
      .orderBy(desc(segments.createdAt));

    if (rows.length === 0) return { segments: [] };

    const counts = await db
      .select({ segmentId: segmentContacts.segmentId, count: sql<number>`count(*)` })
      .from(segmentContacts)
      .where(inArray(segmentContacts.segmentId, rows.map((r) => r.id)))
      .groupBy(segmentContacts.segmentId);
    const countMap = new Map(counts.map((c) => [c.segmentId, Number(c.count)]));

    // Personas live in the shared cross-app DB now -- separate query + Map
    // merge, same idiom as list-personas.ts's own sub-persona/library-doc
    // counts.
    const personaIds = [...new Set(rows.map((r) => r.personaId).filter((id): id is string => !!id))];
    const personaRows = personaIds.length
      ? await getSharedDb()
          .select({ id: sharedPersonas.id, name: sharedPersonas.name, color: sharedPersonas.color })
          .from(sharedPersonas)
          .where(inArray(sharedPersonas.id, personaIds))
      : [];
    const personaById = new Map(personaRows.map((p) => [p.id, p]));

    return {
      segments: rows.map((r) => ({
        ...r,
        personaName: r.personaId ? (personaById.get(r.personaId)?.name ?? null) : null,
        personaColor: r.personaId ? (personaById.get(r.personaId)?.color ?? null) : null,
        kind: r.sourcingRuleId != null ? ("prospected" as const) : r.marketingRuleId != null ? ("marketing" as const) : ("static" as const),
        contactCount: countMap.get(r.id) ?? 0,
      })),
    };
  },
});
