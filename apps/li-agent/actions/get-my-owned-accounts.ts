import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { fetchOwnedAccounts } from "../server/helpers/owned-accounts.js";

// Powers the "My Accounts" page -- a user's own book of business. The
// actual HubSpot work lives in server/helpers/owned-accounts.ts, shared
// with generate-sales-nav-search.ts so the AI search assistant resolves
// "my accounts" against exactly the same list this page shows.
export default defineAction({
  description:
    "List HubSpot companies where the current user is either the Company owner (hubspot_owner_id, the AE-facing property) or the custom xDR Owner (xdr_owner) -- an OR across both, resolved by matching their app email to a HubSpot owner record. Read-only.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) return { connected: false, matched: false, companies: [], total: 0 };

    if (!(await checkRateLimit(userEmail, "get-my-owned-accounts", 60))) {
      return { connected: true, matched: false, companies: [], total: 0, error: "Rate limit reached -- try again shortly." };
    }

    const result = await fetchOwnedAccounts(userEmail);
    if (result.status === "notConnected") return { connected: false, matched: false, companies: [], total: 0 };
    if (result.status === "noOwnerRecord") {
      return { connected: true, matched: false, companies: [], total: 0, noOwnerRecord: true };
    }

    return {
      connected: true,
      matched: true,
      companies: result.accounts,
      total: result.total,
      truncated: result.truncated,
    };
  },
});
