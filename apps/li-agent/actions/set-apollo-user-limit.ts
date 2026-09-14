import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { setUserCreditLimit } from "../server/helpers/apollo-credits/user-limits.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

export default defineAction({
  description:
    "Set or clear one user's Apollo credit allowance for a billing period. Passing null clears it so the user inherits the workspace default.",
  schema: z.object({
    userEmail: z.string().min(1),
    // null CLEARS the row rather than pinning the user to today's default --
    // otherwise a later change to the workspace default would silently skip
    // everyone who had ever been listed here.
    creditLimit: z.number().int().min(0).max(100_000_000).nullable(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: {
    target: (args) => ({ type: "user", id: args.userEmail }),
    summary: (args) =>
      args.creditLimit == null
        ? `Cleared the Apollo credit allowance for ${args.userEmail} (inherits the workspace default)`
        : `Set the Apollo credit allowance for ${args.userEmail} to ${args.creditLimit}`,
  },
  run: async ({ userEmail, creditLimit }, ctx) => {
    await requireAdmin(ctx);
    await setUserCreditLimit(userEmail, creditLimit);
    return { ok: true as const, userEmail: userEmail.toLowerCase(), creditLimit };
  },
});
