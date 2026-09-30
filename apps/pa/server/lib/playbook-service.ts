// Glue between the playbook core and actions (D44): identity, error mapping,
// and what happens after a publish.
import { fail, type ActionRunContext } from "@agent-native/core/action";
import { queueAutomationRunNow } from "@agent-native/core/triggers";

import {
  ChangeError,
  recordFindings,
  type Actor,
  type Deps,
  type Published,
} from "../core/playbook/changes.js";
import { auditRelease } from "../core/playbook/checks.js";
import { replayImpact } from "../core/playbook/impact.js";
import { newId, now, repo } from "./pa-context.js";
import { teamDirectory } from "./pa-roles.js";
import { deliverSuggestions } from "./suggestion-delivery.js";

export const REVIEW_AUTOMATION = "pa-playbook-review";

/**
 * Check-raised suggestions the new release no longer produces are done: the
 * mapping was filled, the knowledge written, the value supported. Agent
 * suggestions stay for a person to close.
 */
async function closeResolvedSuggestions(published: Published): Promise<number> {
  const repository = repo();
  const still = new Set(
    auditRelease(published.release).map((finding) => finding.dedupeKey),
  );
  const open = await repository.listSuggestions({
    statuses: ["open", "accepted"],
    limit: 500,
  });
  let closed = 0;
  for (const suggestion of open) {
    if (suggestion.source !== "check" || still.has(suggestion.dedupeKey))
      continue;
    // Keys that only a change raises (a new rule's CRM field) are resolved
    // only when the audit of the whole release can see them.
    if (
      !/^(crm_field:map|crm_field:portal|knowledge|feature:param|feature:value)/.test(
        suggestion.dedupeKey,
      )
    )
      continue;
    const at = now().toISOString();
    await repository.updateSuggestion(
      suggestion.id,
      {
        status: "done",
        decidedBy: `system:resolved-by:${published.release.short_id}`,
        decidedAt: at,
        updatedAt: at,
      },
      suggestion.version,
    );
    closed += 1;
  }
  return closed;
}
export const LEARNING_AUTOMATION = "pa-weekly-learning";

export function playbookDeps(): Deps {
  return { repo: repo(), now, newId };
}

export function actorOf(ctx: ActionRunContext | undefined): Actor {
  if (!ctx?.userEmail)
    fail("Sign in to change the playbook", { statusCode: 401 });
  return { email: ctx.userEmail.toLowerCase(), caller: ctx.caller };
}

export { replayImpact, teamDirectory };

/** Maps workflow errors to action errors with their status codes. */
export async function orFail<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ChangeError)
      fail(error.message, { statusCode: error.statusCode });
    throw error;
  }
}

/**
 * After a publish: findings become suggestions and reach their audience, and
 * the agent review is queued durably (the in-process event bus is not
 * durable on serverless, so it is not used for this handoff).
 */
export async function afterPublish(
  published: Published,
  ctx: ActionRunContext | undefined,
) {
  const deps = playbookDeps();
  const created = await recordFindings(deps, published.findings, {
    releaseId: published.release.id,
    changeId: published.change.id,
  });
  await deliverSuggestions(deps.repo, created, ctx?.orgId ?? null, now);
  const resolved = await closeResolvedSuggestions(published);
  let review: "queued" | "not_enabled" | "failed" = "not_enabled";
  if (ctx?.orgId) {
    try {
      await queueAutomationRunNow({
        userEmail: ctx.userEmail as string,
        orgId: ctx.orgId,
        appId: "pa",
        scope: "organization",
        name: REVIEW_AUTOMATION,
      });
      review = "queued";
    } catch (error) {
      // The review automation is enabled once by the app owner
      // (enable-playbook-review); until then the check findings still land.
      const message = error instanceof Error ? error.message : String(error);
      review = /not found|no automation|does not exist|404/i.test(message)
        ? "not_enabled"
        : "failed";
      if (review === "failed")
        console.warn("[pa] Could not queue the playbook review:", message);
    }
  }
  return {
    suggestionsCreated: created.length,
    suggestionsResolved: resolved,
    review,
  };
}

/** The app owner, in person: CRM credentials never go through the agent (D47). */
export async function requireOwnerInPerson(
  ctx: ActionRunContext | undefined,
  what: string,
) {
  const actor = actorOf(ctx);
  if (!["frontend", "cli"].includes(actor.caller))
    fail(`${what} is done by the app owner in person`, { statusCode: 403 });
  if (!(await teamDirectory(ctx).isAppOwner(actor.email)))
    fail(`Only the app owner can ${what.toLowerCase()}`, { statusCode: 403 });
  return actor;
}
