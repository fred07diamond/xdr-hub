import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { EVALUATORS } from "../server/core/playbook/capabilities.js";
import { loadPortalSchema } from "../server/lib/crm-schema.js";
import { activeRelease } from "../server/lib/pa-context.js";
import {
  CANONICAL_FIELDS,
  mappingProblems,
  mappingValue,
  suggestMappings,
} from "../shared/crm-mapping.js";

export default defineAction({
  description:
    "The CRM field mapping: each field PA's rules read, which rules read it, the HubSpot property it maps to in the active release, the portal's property definitions (if refreshed), suggested matches for unmapped fields, and problems (a mapped property that no longer exists or has the wrong type). Read this before drafting a mapping change.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const release = await activeRelease();
    const mapping = release.config.hubspot_mapping;
    const portal = await loadPortalSchema();
    const usedBy = (key: string) =>
      Object.entries(EVALUATORS)
        .filter(([, evaluator]) => evaluator.crmFields.includes(key))
        .map(([id]) => id);
    return {
      releaseShortId: release.short_id,
      mapping,
      fields: CANONICAL_FIELDS.map((field) => ({
        ...field,
        usedBy: usedBy(field.key),
        current: field.mapping
          ? (mappingValue(mapping, field.mapping) ?? null)
          : null,
      })),
      portal,
      suggestions: portal ? suggestMappings(mapping, portal) : [],
      problems: portal ? mappingProblems(mapping, portal) : [],
    };
  },
});
