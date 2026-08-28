import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { enrichApolloOrganization, matchApolloPerson } from "../server/helpers/apollo-client.js";

// Temporary diagnostic — not part of any product flow. Empirically confirms
// every distinct Apollo code path (person match w/ email, phone reveal via
// the same call, organization enrichment) is actually blocked by
// APOLLO_ENRICHMENT_DISABLED, rather than just reading the flag's value.
// No real Apollo call reaches their API if this is working -- apolloFetch()
// throws before ever calling fetch(). Delete once confirmed.
export default defineAction({
  description: "Empirically test whether every Apollo enrichment code path (person match, phone reveal, org enrich) is actually blocked.",
  schema: z.object({}),
  requiresAuth: true,
  http: { method: "GET" },
  run: async () => {
    const results: Record<string, { blocked: boolean; detail: string }> = {};

    try {
      await matchApolloPerson({ name: "Test Person", companyName: "Test Company", revealPhone: false });
      results.personMatch = { blocked: false, detail: "call succeeded (unexpected)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.personMatch = { blocked: message.includes("temporarily disabled"), detail: message };
    }

    try {
      await matchApolloPerson({ name: "Test Person", companyName: "Test Company", revealPhone: true });
      results.personMatchWithPhoneReveal = { blocked: false, detail: "call succeeded (unexpected)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.personMatchWithPhoneReveal = { blocked: message.includes("temporarily disabled"), detail: message };
    }

    try {
      await enrichApolloOrganization({ domain: "example.com" });
      results.organizationEnrich = { blocked: false, detail: "call succeeded (unexpected)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.organizationEnrich = { blocked: message.includes("temporarily disabled"), detail: message };
    }

    const allBlocked = Object.values(results).every((r) => r.blocked);
    return { allBlocked, results };
  },
});
