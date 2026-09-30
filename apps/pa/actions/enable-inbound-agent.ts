// Framework docs: automations#creating; types in dist/automations/service.d.ts.
import { defineAction, fail } from "@agent-native/core/action";
import {
  defineAutomation,
  listAutomationDefinitions,
} from "@agent-native/core/triggers";
import { z } from "zod";

import {
  INBOUND_AGENT,
  INBOUND_AGENT_BODY,
} from "../server/lib/live-pipeline.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "App owner, people only: turn on the inbound agent. Every 30 minutes it pulls new Contact Sales leads from HubSpot (read-only), assesses each message, and drafts a reply for review. It runs as the app owner, in shadow mode: nothing is sent.",
  schema: z.object({}),
  agentTool: false,
  audit: {
    target: () => ({
      type: "pa-automation",
      id: INBOUND_AGENT,
      visibility: "org" as const,
    }),
    summary: () => "Enabled the inbound agent",
  },
  run: async (_args, ctx) => {
    const actor = actorOf(ctx);
    if (!(await teamDirectory(ctx).isAppOwner(actor.email)))
      fail("Only the app owner can turn on the inbound agent", {
        statusCode: 403,
      });
    if (!ctx?.orgId)
      fail("The inbound agent needs an organization", { statusCode: 409 });
    const automationActor = {
      userEmail: actor.email,
      orgId: ctx.orgId,
      appId: "pa",
    };
    const existing = (
      await listAutomationDefinitions(automationActor, "organization")
    ).some((item) => item.name === INBOUND_AGENT);
    if (existing) return { enabled: true, created: false };
    await defineAutomation(automationActor, {
      name: INBOUND_AGENT,
      scope: "organization",
      triggerType: "schedule",
      schedule: "*/30 * * * *",
      timezone: "America/Los_Angeles",
      body: INBOUND_AGENT_BODY,
      domain: "pa",
    });
    return { enabled: true, created: true };
  },
});
