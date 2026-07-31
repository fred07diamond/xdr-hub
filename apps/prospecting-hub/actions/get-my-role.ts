import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getUserRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Get the current user's workspace role (xdr/ae/admin/none) so the UI can gate admin-only controls.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) return { role: "none" as const };
    const role = await getUserRole(ctx.userEmail);
    return { role };
  },
});
