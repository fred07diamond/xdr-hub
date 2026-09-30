import { defineAction } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import {
  INBOUND_AGENT,
  INTAKE_CORRELATION,
  listAgentWork,
} from "../server/lib/live-pipeline.js";
import { rememberWorkspaceOrg } from "../server/lib/owner-context.js";
import { isPaAdmin, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Live intake status: when Contact Sales leads were last pulled from HubSpot and what came in, how many leads wait for the agent, and whether the inbound agent is on.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    // The board loads this for every signed-in viewer: remember the org so
    // the background poll can act for it (D60).
    await rememberWorkspaceOrg(ctx?.orgId);
    const repository = repo();
    const events = await repository.listEventsByCorrelation(INTAKE_CORRELATION);
    const last = [...events]
      .reverse()
      .find((item) => item.type === "intake.pulled");
    let agentEnabled: boolean | null = null;
    if (ctx?.userEmail && ctx.orgId) {
      try {
        agentEnabled = (
          await listAutomationDefinitions(
            { userEmail: ctx.userEmail, orgId: ctx.orgId, appId: "pa" },
            "organization",
          )
        ).some((item) => item.name === INBOUND_AGENT);
      } catch {
        agentEnabled = null;
      }
    }
    return {
      lastPull: last
        ? { at: last.occurredAt, by: last.actor, ...last.payload }
        : null,
      agentWork: (await listAgentWork(repository, 50)).length,
      agentEnabled,
      canPull: await canEditHandbook(ctx),
      isAppOwner: await isPaAdmin(ctx?.userEmail?.toLowerCase() ?? null),
    };
  },
});
