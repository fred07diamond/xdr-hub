import { defineAction } from "@agent-native/core";
import { desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { personas, prospectPullPlanRuns, prospectPullPlans } from "../server/db/schema.js";
import { getUserRole, requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Return a prospect pull plan's latest reconcile run: per-persona target vs. actual-so-far this cycle, plus any refill-nudge Sales Nav links for personas still short.",
  schema: z.object({ planId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ planId }, ctx) => {
    const role = await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const [plan] = await db.select().from(prospectPullPlans).where(eq(prospectPullPlans.id, planId)).limit(1);
    if (!plan) {
      throw Object.assign(new Error(`Prospect pull plan ${planId} not found.`), { statusCode: 404 });
    }
    // Row-level scoping -- the role gate above only proves the caller is
    // SOME xdr/ae/admin, not that they're allowed to see THIS plan's
    // progress, same discipline as list-sourcing-rule-runs.ts.
    if (plan.ownerEmail !== ctx!.userEmail! && role !== "admin") {
      throw Object.assign(new Error("Only the plan's owner or a manager can view this plan's progress."), {
        statusCode: 403,
      });
    }

    const [latestRun] = await db
      .select()
      .from(prospectPullPlanRuns)
      .where(eq(prospectPullPlanRuns.planId, planId))
      .orderBy(desc(prospectPullPlanRuns.startedAt))
      .limit(1);

    if (!latestRun) {
      return { hasRun: false, breakdown: [] };
    }

    let parsed: { breakdown?: unknown[] } = {};
    try {
      parsed = latestRun.metadata ? JSON.parse(latestRun.metadata) : {};
    } catch {
      parsed = {};
    }
    const rawBreakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];

    const personaIds = rawBreakdown
      .map((b) => (b as { personaId?: string }).personaId)
      .filter((id): id is string => !!id);
    const personaRows = personaIds.length
      ? await db.select({ id: personas.id, name: personas.name, color: personas.color }).from(personas)
      : [];
    const personaMap = new Map(personaRows.map((p) => [p.id, p]));

    return {
      hasRun: true,
      runId: latestRun.id,
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
      status: latestRun.status,
      breakdown: rawBreakdown.map((entry) => {
        const b = entry as {
          personaId: string;
          target: number;
          fromSourcingRule: number;
          fromHubspotSinceLastRun: number;
          fromLinkedinPool: number;
          shortfall: number;
          refillNudgeUrl: string | null;
        };
        const persona = personaMap.get(b.personaId);
        return {
          ...b,
          name: persona?.name ?? "Unknown persona",
          color: persona?.color ?? null,
          actual: b.fromSourcingRule + b.fromHubspotSinceLastRun + b.fromLinkedinPool,
        };
      }),
    };
  },
});
