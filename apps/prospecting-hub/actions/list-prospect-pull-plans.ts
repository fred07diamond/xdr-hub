import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas, prospectPullPlans } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "List prospect pull plans owned by the caller, plus every plan if the caller is an admin — with the persona mix resolved to names/colors.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const role = await getUserRole(ctx!.userEmail!);

    const whereClause = role === "admin" ? undefined : eq(prospectPullPlans.ownerEmail, ctx!.userEmail!);

    const rows = await db
      .select()
      .from(prospectPullPlans)
      .where(whereClause)
      .orderBy(desc(prospectPullPlans.createdAt));

    if (rows.length === 0) return { plans: [] };

    const allPersonas = await db.select({ id: personas.id, name: personas.name, color: personas.color }).from(personas);
    const personaMap = new Map(allPersonas.map((p) => [p.id, p]));

    const plans = rows.map((r) => {
      let personaMix: Array<{ personaId: string; targetPercent: number }> = [];
      try {
        personaMix = JSON.parse(r.personaMix);
      } catch {
        personaMix = [];
      }
      return {
        id: r.id,
        name: r.name,
        ownerEmail: r.ownerEmail,
        totalVolume: r.totalVolume,
        intervalHours: r.intervalHours,
        status: r.status,
        createdAt: r.createdAt,
        lastReconciledAt: r.lastReconciledAt,
        hasHubspot: !!r.marketingRuleIds,
        personaMix: personaMix.map((p) => ({
          personaId: p.personaId,
          targetPercent: p.targetPercent,
          name: personaMap.get(p.personaId)?.name ?? "Unknown persona",
          color: personaMap.get(p.personaId)?.color ?? null,
        })),
      };
    });

    return { plans };
  },
});
