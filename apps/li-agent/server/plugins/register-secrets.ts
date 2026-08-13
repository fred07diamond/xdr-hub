import { defineNitroPlugin } from "@agent-native/core/server";
import { registerRequiredSecret } from "@agent-native/core/secrets";

// Apollo.io enrichment (server/helpers/apollo-client.ts) is optional, on-
// demand functionality used from the Lead Lists page — required: false, so
// it never injects an onboarding-checklist step. Mirrors apps/prospecting-
// hub/server/plugins/register-secrets.ts exactly, including scope:
// "workspace" and the lack of a live-call validator (Apollo's cheapest
// enrichment endpoints still consume paid credits per call).
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
