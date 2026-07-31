import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { commonroomListSegments } from "../server/helpers/commonroom-client.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "List CommonRoom segments (id + name) so a user can pick which one to sync contacts from.",
  schema: z.object({
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().nullish(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ limit, cursor }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const result = await commonroomListSegments({ orgId: ctx?.orgId, limit, cursor: cursor ?? undefined });
    return {
      segments: result.records,
      total: result.total,
      nextCursor: result.nextCursor ?? null,
      hasMore: result.has_more,
    };
  },
});
