import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { editChange } from "../server/core/playbook/changes.js";
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
    "Edit a draft or in-review change: set items (replacing any with the same target), remove items, or retitle. Any edit sends it back to draft and voids earlier approvals.",
  schema: z.object({
    changeId: z.string().min(1),
    set: z.array(changeItemInput).max(25).optional(),
    remove: z.array(z.string()).max(25).optional(),
    title: z.string().min(3).max(140).optional(),
    rationale: z.string().min(3).max(2000).optional(),
  }),
  audit: changeAudit("Edited"),
  run: async (args, ctx) =>
    orFail(async () => ({
      change: await editChange(
        playbookDeps(),
        teamDirectory(ctx),
        actorOf(ctx),
        args,
      ),
    })),
});
