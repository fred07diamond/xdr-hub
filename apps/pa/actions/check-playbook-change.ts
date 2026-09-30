import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { checkPlaybookChange } from "../server/core/playbook/changes.js";
import { loadPortalSchema } from "../server/lib/crm-schema.js";
import { changeAudit } from "../server/lib/playbook-schemas.js";
import {
  orFail,
  playbookDeps,
  replayImpact,
} from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "Run the checks and the impact replay on a change: param errors, rules code cannot enforce yet, CRM fields RevOps must add or map, knowledge gaps, and how the synthetic cases would route and score differently. Rebases onto the active release if another change published first.",
  schema: z.object({ changeId: z.string().min(1) }),
  audit: changeAudit("Checked"),
  run: async (args) =>
    orFail(async () => {
      const { change, result, impact } = await checkPlaybookChange(
        playbookDeps(),
        {
          changeId: args.changeId,
          impact: replayImpact,
          portal: await loadPortalSchema(),
        },
      );
      return {
        change,
        ok: result.ok,
        errors: result.errors,
        findings: result.findings,
        notEnforcedYet: result.pendingBuild,
        requiredTeams: result.requiredTeams,
        impact: {
          changed: impact.filter((item) => item.changed),
          total: impact.length,
        },
      };
    }),
});
