import { createAuthPlugin } from "@agent-native/core/server";

// Extension-facing actions are called cross-origin without a session
// cookie. They must be in publicPaths so the global auth guard lets them
// through before the action route's requiresAuth: false check can fire.
export default createAuthPlugin({
  publicPaths: [
    "/privacy",
    "/_agent-native/actions/capture-profile",
    "/_agent-native/actions/get-draft",
    "/_agent-native/actions/mark-sent",
    "/_agent-native/actions/check-already-contacted",
    "/_agent-native/actions/get-daily-stats",
    "/_agent-native/actions/submit-feedback",
    "/_agent-native/actions/resolve-connect-button",
    "/_agent-native/actions/list-canvases",
    "/_agent-native/actions/check-hubspot-contact",
    "/_agent-native/actions/ingest-post-engager",
    "/_agent-native/actions/get-post-engager",
    "/_agent-native/actions/enrich-post-engager",
    "/_agent-native/actions/import-sales-nav-list",
    "/_agent-native/actions/list-lead-lists-for-extension",
    "/_agent-native/actions/apollo-phone-reveal-webhook",
    "/_agent-native/actions/get-lead-list-items-for-extension",
    "/_agent-native/actions/summarize-lead-list-for-extension",
  ],
});
