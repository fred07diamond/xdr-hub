import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Resolve an array of @builder.io email addresses to full names using HubSpot owner records.",
  schema: z.object({
    emails: z.array(z.string().email()).max(20),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ emails }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    const orgDomain = process.env.WORKSPACE_ORG_DOMAIN?.toLowerCase();
    const names: Record<string, string> = {};

    await Promise.all(
      emails.map(async (email) => {
        if (!email) return;
        if (orgDomain && !email.toLowerCase().endsWith(`@${orgDomain}`)) return;
        try {
          const result = (await hubspotFetch(`/crm/v3/owners?email=${encodeURIComponent(email)}`)) as {
            results?: Array<{ firstName?: string; lastName?: string; email?: string }>;
          };
          const owner = result.results?.[0];
          if (owner) {
            const fullName = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
            if (fullName) names[email] = fullName;
          }
        } catch {
          // Best-effort — fall back to email display
        }
      }),
    );

    return { names };
  },
});
