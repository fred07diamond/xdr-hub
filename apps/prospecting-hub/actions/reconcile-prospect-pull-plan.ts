import { defineAction } from "@agent-native/core";
import { invokeAgentAction } from "@agent-native/core/a2a";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, personas, prospectPullPlanRuns, prospectPullPlans } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

interface PersonaMixEntry {
  personaId: string;
  targetPercent: number;
}

interface LiAgentLead {
  id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string | null;
}

// One bounded call to li-agent per persona per reconcile tick -- a
// hiccup on li-agent's side (down, timeout, no connectorCatalog entry yet)
// must degrade to "no LinkedIn contribution this cycle," never fail the
// whole reconcile run. Mirrors this app's own "external hiccup -> null
// signal, never fail the operation" discipline (score-contact.ts,
// commonroom-client.ts).
async function callLiAgent<T>(action: string, input: Record<string, unknown>, userEmail: string): Promise<T | null> {
  try {
    const { result } = await invokeAgentAction({ target: "li-agent", action, input, userEmail });
    if (result.status !== "completed") return null;
    return JSON.parse(result.output) as T;
  } catch (err) {
    console.error(`[reconcile-prospect-pull-plan] li-agent call to "${action}" failed:`, err);
    return null;
  }
}

export default defineAction({
  description:
    "Reconcile one prospect pull plan for the current cycle: count this cycle's new contacts per persona against target, top up any shortfall from li-agent's already-captured LinkedIn lead pool (deduped by externalId so a lead is never imported twice), and generate a refill-nudge Sales Nav link for any persona still short after that. A single bounded call, not a resumable loop -- there is no long-running search/score phase here, unlike run-sourcing-rule-pipeline.ts.",
  schema: z.object({ planId: z.string().min(1) }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ planId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const userEmail = ctx!.userEmail!;

    const [plan] = await db.select().from(prospectPullPlans).where(eq(prospectPullPlans.id, planId)).limit(1);
    if (!plan) {
      throw Object.assign(new Error(`Prospect pull plan ${planId} not found.`), { statusCode: 404 });
    }

    let personaMix: PersonaMixEntry[] = [];
    try {
      personaMix = JSON.parse(plan.personaMix);
    } catch {
      personaMix = [];
    }

    // First reconcile ever: count from the plan's own creation, not the
    // beginning of time -- a plan created mid-cycle shouldn't retroactively
    // claim credit for contacts synced before it existed.
    const windowStart = plan.lastReconciledAt ?? plan.createdAt ?? new Date(0).toISOString();
    const now = new Date().toISOString();

    const breakdown: Array<{
      personaId: string;
      target: number;
      fromSourcingRule: number;
      fromHubspotSinceLastRun: number;
      fromLinkedinPool: number;
      shortfall: number;
      refillNudgeUrl: string | null;
    }> = [];

    for (const { personaId, targetPercent } of personaMix) {
      const target = Math.max(1, Math.round((plan.totalVolume * targetPercent) / 100));

      const [personaRow] = await db
        .select({ liAgentPersonaId: personas.liAgentPersonaId })
        .from(personas)
        .where(eq(personas.id, personaId))
        .limit(1);

      const countsBySource = await db
        .select({ source: contacts.source, n: sql<number>`count(*)` })
        .from(contacts)
        .where(and(eq(contacts.personaId, personaId), sql`${contacts.syncedAt} >= ${windowStart}`))
        .groupBy(contacts.source);

      let fromSourcingRule = 0;
      let fromHubspotSinceLastRun = 0;
      for (const row of countsBySource) {
        if (row.source === "hubspot") fromHubspotSinceLastRun += Number(row.n);
        else if (row.source === "commonroom" || row.source === "prospector") fromSourcingRule += Number(row.n);
      }

      let remaining = target - fromSourcingRule - fromHubspotSinceLastRun;
      let fromLinkedinPool = 0;
      let refillNudgeUrl: string | null = null;

      // No li-agent persona linked yet -- skip the LinkedIn leg entirely for
      // this persona (no pool pull, no refill nudge) rather than guessing.
      if (remaining > 0 && personaRow?.liAgentPersonaId) {
        const leadsResult = await callLiAgent<{ leads: LiAgentLead[] }>(
          "list-unused-persona-leads",
          { personaId: personaRow.liAgentPersonaId, limit: remaining },
          userEmail,
        );

        for (const lead of leadsResult?.leads ?? []) {
          if (!lead.name) continue; // nothing useful to sort, same convention as sync-commonroom.ts

          // Dedup against a prior cycle's import -- li-agent's own read has
          // no concept of "already handed to prospecting-hub," so this side
          // must be the one that stops re-importing the same lead.
          const existing = await db
            .select({ id: contacts.id })
            .from(contacts)
            .where(and(eq(contacts.externalId, lead.id), eq(contacts.source, "linkedin")))
            .limit(1);
          if (existing[0]) continue;

          await db.insert(contacts).values({
            id: nanoid(),
            name: lead.name,
            title: lead.title,
            company: lead.company,
            linkedinUrl: lead.linkedinUrl,
            source: "linkedin",
            externalId: lead.id,
            personaId,
            status: "active",
            syncedAt: now,
            createdAt: now,
            updatedAt: now,
          });
          fromLinkedinPool++;
        }
        remaining -= fromLinkedinPool;
      }

      if (remaining > 0 && personaRow?.liAgentPersonaId) {
        const linkResult = await callLiAgent<{ searchUrl?: string; error?: string }>(
          "generate-persona-search-link",
          { personaId: personaRow.liAgentPersonaId },
          userEmail,
        );
        refillNudgeUrl = linkResult?.searchUrl ?? null;
      }

      breakdown.push({
        personaId,
        target,
        fromSourcingRule,
        fromHubspotSinceLastRun,
        fromLinkedinPool,
        shortfall: Math.max(0, remaining),
        refillNudgeUrl,
      });
    }

    const runId = nanoid();
    await db.insert(prospectPullPlanRuns).values({
      id: runId,
      planId,
      startedAt: now,
      completedAt: new Date().toISOString(),
      status: "success",
      metadata: JSON.stringify({ breakdown }),
      error: null,
    });

    await db.update(prospectPullPlans).set({ lastReconciledAt: now }).where(eq(prospectPullPlans.id, planId));

    return { runId, breakdown };
  },
});
