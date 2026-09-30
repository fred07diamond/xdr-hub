import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { proposeChange } from "../server/core/playbook/changes.js";
import {
  changeAudit,
  changeItemInput,
} from "../server/lib/playbook-schemas.js";
import {
  actorOf,
  orFail,
  playbookDeps,
  teamDirectory,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "Draft a playbook change set against the active release. Anyone on the PA team or RevOps (or the app owner) can draft, and the agent can draft for them. Nothing takes effect until the owning teams approve and a person publishes. Run check-playbook-change next.",
  schema: z.object({
    title: z.string().min(3).max(140),
    rationale: z
      .string()
      .min(3)
      .max(2000)
      .describe("Why: the source, the problem, or the correction behind it"),
    items: z.array(changeItemInput).min(1).max(25),
  }),
  audit: changeAudit("Drafted"),
  run: async (args, ctx) =>
    orFail(async () => {
      const change = await proposeChange(
        playbookDeps(),
        teamDirectory(ctx),
        actorOf(ctx),
        args,
      );
      return { change };
    }),
});
