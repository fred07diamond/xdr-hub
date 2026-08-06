import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

// Apollo.io enrichment (server/helpers/apollo-client.ts) is optional, on-
// demand functionality, not core to this app — required: false, so it never
// injects an onboarding-checklist step. scope: "workspace" (org-wide, one
// key per org) follows the secrets skill's own documented contract; this is
// the first registerRequiredSecret call anywhere in this repo (HubSpot's
// token is read via readAppSecret directly, with no sidebar registration at
// all — see hubspot-client.ts).
//
// No live-call validator here, unlike the skill's own OpenAI example:
// Apollo's cheapest enrichment endpoints still consume paid credits per
// call, and a validator runs on every save AND every "Test" click — wiring
// one up would silently spend the org's Apollo credits just to check the
// key is well-formed. If Apollo exposes a genuinely free auth-check
// endpoint, add a validator here later.
export default defineNitroPlugin(() => {
  registerRequiredSecret({
    key: "APOLLO_API_KEY",
    label: "Apollo.io API Key",
    description: "Used for on-demand contact/company enrichment from Apollo.io.",
    docsUrl: "https://docs.apollo.io/docs/api-key",
    scope: "workspace",
    kind: "api-key",
    required: false,
  });
});
