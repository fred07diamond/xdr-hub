import { defineAction } from "@agent-native/core";
import { invokeAgentAction } from "@agent-native/core/a2a";
import { and, eq, inArray, isNull, sql } from "@agent-native/core/db/schema";
import { getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, prospectPullPlanRuns, prospectPullPlans } from "../server/db/schema.js";
import {
  enrollContactInFlow,
  listHubSpotFlows,
  matchWorkflowForPersona,
  upsertHubSpotContact,
} from "../server/helpers/hubspot-workflow.js";
import { addProspectorContactToCommonRoom } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";

// Bounded per persona per tick -- each contact costs up to 3 sequential
// network calls (CommonRoom add, minimal HubSpot contact create, HubSpot
// workflow enroll), so this keeps one reconcile invocation for one plan
// well within a single serverless invocation even with an unlucky number of
// personas.
const HUBSPOT_ENROLL_BATCH_SIZE = 20;

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
    "Reconcile one prospect pull plan for the current cycle: count this cycle's new contacts per persona against target, top up any shortfall from li-agent's already-captured LinkedIn lead pool (deduped by externalId so a lead is never imported twice), generate a refill-nudge Sales Nav link for any persona still short after that, and — when the plan's autoEnrollHubspotWorkflow is on — create a minimal HubSpot contact for each newly-synced CommonRoom/Prospector-leg contact and enroll it in that persona's matching HubSpot workflow (resolved by name against HubSpot's flow list); the workflow itself owns everything past enrollment. A single bounded call, not a resumable loop -- there is no long-running search/score phase here, unlike run-sourcing-rule-pipeline.ts.",
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
      hubspotEnrolled: number;
      hubspotEnrollErrors: number;
      hubspotWorkflowError: string | null;
    }> = [];

    // Fetched once for the whole tick, not once per persona -- every
    // persona's workflow lookup matches against the same flow list.
    const hubspotFlows = plan.autoEnrollHubspotWorkflow ? await listHubSpotFlows() : [];
    const personaNameRows = plan.autoEnrollHubspotWorkflow
      ? await getSharedDb()
          .select({ id: sharedPersonas.id, name: sharedPersonas.name })
          .from(sharedPersonas)
          .where(inArray(sharedPersonas.id, personaMix.map((p) => p.personaId)))
      : [];
    const personaNameById = new Map(personaNameRows.map((p) => [p.id, p.name]));

    for (const { personaId, targetPercent } of personaMix) {
      const target = Math.max(1, Math.round((plan.totalVolume * targetPercent) / 100));

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

      // personaId is now a SHARED id valid directly on both sides -- no
      // separate li-agent-persona-id lookup/gate needed anymore, just try
      // the call and degrade gracefully (existing try/catch-and-null in
      // callLiAgent) if li-agent doesn't recognize it or is unreachable.
      if (remaining > 0) {
        const leadsResult = await callLiAgent<{ leads: LiAgentLead[] }>(
          "list-unused-persona-leads",
          { personaId, limit: remaining },
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

      if (remaining > 0) {
        const linkResult = await callLiAgent<{ searchUrl?: string; error?: string }>(
          "generate-persona-search-link",
          { personaId },
          userEmail,
        );
        refillNudgeUrl = linkResult?.searchUrl ?? null;
      }

      // Create a bare-minimum HubSpot contact (just enough to get an id) for
      // each newly-synced, not-yet-enrolled CommonRoom/Prospector-leg
      // contact for this persona, then call HubSpot's enrollment endpoint --
      // the already-built HubSpot workflow does everything past that itself
      // (list membership, branching, etc.), so nothing else happens here.
      // Scoped to pull-plan-created sourcing rules only (this whole block,
      // via plan.autoEnrollHubspotWorkflow), never every sourcing rule in
      // the app. Contacts already enrolled OR permanently failed
      // (hubspotEnrollError set) are excluded, so this only ever touches
      // genuinely new work each tick.
      let hubspotEnrolled = 0;
      let hubspotEnrollErrors = 0;
      let hubspotWorkflowError: string | null = null;

      if (plan.autoEnrollHubspotWorkflow) {
        const personaName = personaNameById.get(personaId);
        let workflowId: string | null = null;
        try {
          if (!personaName) throw new Error(`Persona ${personaId} not found.`);
          workflowId = matchWorkflowForPersona(hubspotFlows, personaName);
        } catch (err) {
          hubspotWorkflowError = err instanceof Error ? err.message : String(err);
        }

        if (workflowId) {
          const pending = await db
            .select({ id: contacts.id, name: contacts.name, company: contacts.company, title: contacts.title, externalId: contacts.externalId, hubspotContactId: contacts.hubspotContactId })
            .from(contacts)
            .where(
              and(
                eq(contacts.personaId, personaId),
                eq(contacts.source, "prospector"),
                isNull(contacts.hubspotEnrollError),
                isNull(contacts.hubspotWorkflowEnrolledAt),
              ),
            )
            .limit(HUBSPOT_ENROLL_BATCH_SIZE);

          for (const contact of pending) {
            try {
              let hubspotContactId = contact.hubspotContactId;
              if (!hubspotContactId) {
                // externalId is this contact's ProspectorContact id, captured
                // at import time (run-sourcing-rule-pipeline.ts) -- the same
                // id CommonRoom's own "Add" button would act on.
                const added = contact.externalId
                  ? await addProspectorContactToCommonRoom(ctx?.orgId, contact.externalId)
                  : { commonRoomContactId: null, email: null };
                hubspotContactId = await upsertHubSpotContact({
                  email: added.email,
                  fullName: contact.name,
                  company: contact.company,
                  title: contact.title,
                });
                await db.update(contacts).set({ hubspotContactId, updatedAt: now }).where(eq(contacts.id, contact.id));
              }
              await enrollContactInFlow(workflowId, hubspotContactId);
              await db.update(contacts).set({ hubspotWorkflowEnrolledAt: now, updatedAt: now }).where(eq(contacts.id, contact.id));
              hubspotEnrolled++;
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await db.update(contacts).set({ hubspotEnrollError: message, updatedAt: now }).where(eq(contacts.id, contact.id));
              hubspotEnrollErrors++;
            }
          }
        }
      }

      breakdown.push({
        personaId,
        target,
        fromSourcingRule,
        fromHubspotSinceLastRun,
        fromLinkedinPool,
        shortfall: Math.max(0, remaining),
        refillNudgeUrl,
        hubspotEnrolled,
        hubspotEnrollErrors,
        hubspotWorkflowError,
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
