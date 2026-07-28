import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getUserRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Return the current user's email and app role (xdr, ae, admin, none).",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const email = ctx?.userEmail ?? "";
    const role = email ? await getUserRole(email) : "none";
    return { email, role };
  },
});
