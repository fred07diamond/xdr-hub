import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { searchIcpCompanies } from "../server/helpers/icp-filters.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Search CommonRoom Prospector for companies matching an ICP (deriving industry/headcount filters from its criteria text). Read-only preview of the company-qualification stage of the two-stage Prospector search — does not import or write anything.",
  schema: z.object({
    icpId: z.string().min(1),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ icpId, limit }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    return searchIcpCompanies({
      icpId,
      userEmail: ctx!.userEmail!,
      orgId: ctx?.orgId,
      limit,
    });
  },
});
