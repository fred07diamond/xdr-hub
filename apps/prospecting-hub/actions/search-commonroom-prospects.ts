import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { deriveProspectorFilters } from "../server/helpers/derive-prospector-filters.js";
import { searchProspectorContacts } from "../server/helpers/prospector-client.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Search CommonRoom Prospector for contacts matching a persona (deriving title/seniority filters from its criteria text), with optional company allow/deny lists. Read-only preview — does not import or write anything.",
  schema: z.object({
    personaId: z.string().min(1),
    subPersonaId: z.string().nullish(),
    companyAllowList: z.array(z.string()).nullish(),
    companyDenyList: z.array(z.string()).nullish(),
    limit: z.number().int().min(1).max(200).default(20),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ personaId, subPersonaId, companyAllowList, companyDenyList, limit }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    const filters = await deriveProspectorFilters({
      personaId,
      subPersonaId,
      userEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
    });

    return searchProspectorContacts({
      orgId: ctx?.orgId,
      titleKeyword: filters.titleKeyword ?? undefined,
      seniority: filters.seniority ?? undefined,
      companyAllowList: companyAllowList ?? undefined,
      companyDenyList: companyDenyList ?? undefined,
      limit,
    });
  },
});
