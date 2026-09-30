import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listAgentWork } from "../server/lib/live-pipeline.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "The inbound agent's queue: live leads waiting for a message assessment (inbound-message-assessment skill, then save-message-assessment) or a first-touch draft (first-touch-drafting skill, then save-draft). Work oldest first. Saving an assessment continues that lead's pipeline, which may add a draft to the queue.",
  schema: z.object({
    limit: z.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => ({ work: await listAgentWork(repo(), args.limit) }),
});
