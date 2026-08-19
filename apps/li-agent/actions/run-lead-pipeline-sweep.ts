import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { runLeadPipelineSweepTick } from "../server/helpers/lead-pipeline-sweep.js";

// Manual/on-demand trigger for one bounded tick of the automatic lead
// pipeline (server/helpers/lead-pipeline-sweep.ts) -- normally invoked
// opportunistically by server/middleware/lead-pipeline-sweep.ts on real
// traffic. Exists so a real, zero-traffic-independent trigger can be
// wired up later (a recurring job via the Agent page's Jobs tab, whose
// instructions call this action) without needing a code change then, and
// so the pipeline can be exercised/verified directly right now.
export default defineAction({
  description: "Run one batch of the automatic lead enrich/score/draft background pipeline immediately.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "POST" },
  run: async () => {
    await runLeadPipelineSweepTick();
    return { ok: true };
  },
});
