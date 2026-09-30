// Framework docs: automations#creating; types in dist/automations/service.d.ts.
import { defineAction, fail } from "@agent-native/core/action";
import {
  defineAutomation,
  listAutomationDefinitions,
} from "@agent-native/core/triggers";
import { z } from "zod";

import {
  actorOf,
  LEARNING_AUTOMATION,
  REVIEW_AUTOMATION,
  teamDirectory,
} from "../server/lib/playbook-service.js";

const REVIEW_BODY = `Follow the playbook-steward skill.
Review every published playbook change the agent has not reviewed yet:
1. Call list-playbook-changes with status published, and keep those with agentReviewedAt null.
2. For each, call get-playbook-change and list-playbook, and list-suggestions with every status for the context.
3. Record suggestions with record-suggestion: board reorganizations (kind view), skill or knowledge updates, and features for the app owner with a short spec. Do not repeat a suggestion that already exists.
4. Call complete-playbook-review for each change with the number you recorded.
Never approve, publish, or change the CRM.`;

const LEARNING_BODY = `Follow the playbook-steward skill.
Once a week, look at how the team actually worked: list-inbound (recycled, disqualified, attached, and flagged leads), open and dismissed suggestions, and playbook changes from the last seven days.
Where the rules and the team's behavior disagree (leads pulled back from recycle, repeated reassignments, suggestions dismissed for the same reason), record a suggestion with record-suggestion, or draft a playbook change with propose-playbook-change and check-playbook-change for a person to review.
Also review any published change that still has agentReviewedAt null, as the pa-playbook-review automation would.`;

export default defineAction({
  description:
    "App owner, people only: turn on the agent's playbook review (after every publish) and the weekly learning job. Both run as the app owner and can only draft changes and record suggestions.",
  schema: z.object({}),
  agentTool: false,
  audit: {
    target: () => ({
      type: "pa-automation",
      id: REVIEW_AUTOMATION,
      visibility: "org" as const,
    }),
    summary: () => "Enabled the playbook review automations",
  },
  run: async (_args, ctx) => {
    const actor = actorOf(ctx);
    if (!(await teamDirectory(ctx).isAppOwner(actor.email)))
      fail("Only the app owner can enable the playbook review", {
        statusCode: 403,
      });
    if (!ctx?.orgId)
      fail("The playbook review needs an organization", { statusCode: 409 });
    const automationActor = {
      userEmail: actor.email,
      orgId: ctx.orgId,
      appId: "pa",
    };
    const existing = new Set(
      (await listAutomationDefinitions(automationActor, "organization")).map(
        (item) => item.name,
      ),
    );
    const created: string[] = [];
    if (!existing.has(REVIEW_AUTOMATION)) {
      // Run on demand: publish-playbook-change queues it with queueAutomationRunNow.
      await defineAutomation(automationActor, {
        name: REVIEW_AUTOMATION,
        scope: "organization",
        triggerType: "event",
        event: "pa.playbook.published",
        body: REVIEW_BODY,
        domain: "pa",
      });
      created.push(REVIEW_AUTOMATION);
    }
    if (!existing.has(LEARNING_AUTOMATION)) {
      await defineAutomation(automationActor, {
        name: LEARNING_AUTOMATION,
        scope: "organization",
        triggerType: "schedule",
        schedule: "0 8 * * 1",
        timezone: "America/Los_Angeles",
        body: LEARNING_BODY,
        domain: "pa",
      });
      created.push(LEARNING_AUTOMATION);
    }
    return {
      created,
      alreadyEnabled: [...existing].filter(
        (name) => name === REVIEW_AUTOMATION || name === LEARNING_AUTOMATION,
      ),
    };
  },
});
