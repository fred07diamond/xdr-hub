import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { withdrawChange } from "../server/core/playbook/changes.js";
import { changeAudit } from "../server/lib/playbook-schemas.js";
import {
  actorOf,
  orFail,
  playbookDeps,
  teamDirectory,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description: "Withdraw a draft or in-review change. It stays on record.",
  schema: z.object({ changeId: z.string().min(1) }),
  audit: changeAudit("Withdrew"),
  run: async (args, ctx) =>
    orFail(async () => ({
      change: await withdrawChange(
        playbookDeps(),
        teamDirectory(ctx),
        actorOf(ctx),
        args.changeId,
      ),
    })),
});
