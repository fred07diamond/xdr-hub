import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { submitChange } from "../server/core/playbook/changes.js";
import { changeAudit } from "../server/lib/playbook-schemas.js";
import {
  actorOf,
  orFail,
  playbookDeps,
  teamDirectory,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "Send a checked change for review by its owning teams. The checks must be current and pass.",
  schema: z.object({ changeId: z.string().min(1) }),
  audit: changeAudit("Submitted"),
  run: async (args, ctx) =>
    orFail(async () => ({
      change: await submitChange(
        playbookDeps(),
        teamDirectory(ctx),
        actorOf(ctx),
        args.changeId,
      ),
    })),
});
