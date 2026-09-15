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
    "/_agent-native/actions/generate-sales-nav-search",
    // Both of these were shipped WITHOUT being listed here and were therefore
    // dead: the guard rejected them with {"error":"Unauthorized"} before the
    // action ran, so check-leads-in-lists never reconciled a deleted list and
    // the extension's contact buttons did nothing. `requiresAuth: false` and
    // `publicAgent` on the action are NOT sufficient -- see the note above.
    "/_agent-native/actions/check-leads-in-lists",
    "/_agent-native/actions/extension-get-contact",
    // These four were ALSO dead, and not recently: the extension's
    // Settings -> ICP Personas panel and its Sales Nav "already captured"
    // check have been returning {"error":"Unauthorized"} the whole time.
    // Found by deriving the list from what extension/*.js actually fetches
    // rather than from what the actions declare -- see
    // test/public-action-paths.test.ts.
    "/_agent-native/actions/list-icp-personas",
    "/_agent-native/actions/add-persona-documents",
    "/_agent-native/actions/delete-persona-document",
    "/_agent-native/actions/check-sales-nav-leads-captured",
  ],
});
