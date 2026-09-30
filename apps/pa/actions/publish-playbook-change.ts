import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { publishChange } from "../server/core/playbook/changes.js";
import { loadPortalSchema } from "../server/lib/crm-schema.js";
import { changeAudit } from "../server/lib/playbook-schemas.js";
import {
  actorOf,
  afterPublish,
  orFail,
  playbookDeps,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "People only: publish an approved change as a new immutable release and make it active. New engagements pin it; existing ones keep theirs. Raises suggestions for anything code or the CRM cannot support yet, and queues the agent review. The agent cannot call this.",
  schema: z.object({ changeId: z.string().min(1) }),
  // Hidden from every agent tool surface (in-app, MCP, A2A); the actor check
  // in the workflow refuses tool and automation callers as a second guard.
  agentTool: false,
  audit: changeAudit("Published"),
  run: async (args, ctx) =>
    orFail(async () => {
      const published = await publishChange(
        playbookDeps(),
        actorOf(ctx),
        args.changeId,
        await loadPortalSchema(),
      );
      const followUp = await afterPublish(published, ctx);
      return {
        change: published.change,
        release: {
          id: published.release.id,
          shortId: published.release.short_id,
        },
        ...followUp,
      };
    }),
});
