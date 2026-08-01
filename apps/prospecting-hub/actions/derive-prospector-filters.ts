import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Derive suggested CommonRoom Prospector search parameters (title keyword, seniority) from a persona's (and optional sub-persona's) synced criteria text, via one grounded completeText() call. This is a preview/suggestion — the sourcing rule pipeline uses it directly; there is no separate human-review step.",
  schema: z.object({ personaId: z.string().min(1), subPersonaId: z.string().nullish() }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ personaId, subPersonaId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    return deriveProspectorFilters({
      personaId,
      subPersonaId,
      userEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
    });
  },
});
