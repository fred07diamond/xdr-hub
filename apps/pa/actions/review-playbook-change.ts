import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { reviewChange } from "../server/core/playbook/changes.js";
import { changeAudit } from "../server/lib/playbook-schemas.js";
import {
  actorOf,
  orFail,
  playbookDeps,
  teamDirectory,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "People only: approve or reject a change in review for one owning team. The reviewer must be on that team and not the author; the app owner may stand in only for a team with no members. The agent cannot call this.",
  schema: z.object({
    changeId: z.string().min(1),
    team: z.enum(["pa_team", "revops"]),
    decision: z.enum(["approve", "reject"]),
    note: z.string().max(1000).optional(),
  }),
  // Hidden from every agent tool surface (in-app, MCP, A2A); the actor check
  // in the workflow refuses tool and automation callers as a second guard.
  agentTool: false,
  audit: changeAudit("Reviewed"),
  run: async (args, ctx) =>
    orFail(async () =>
      reviewChange(playbookDeps(), teamDirectory(ctx), actorOf(ctx), args),
    ),
});
