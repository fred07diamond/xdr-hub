import { createAuthPlugin } from "@agent-native/core/server";

// The four extension-facing actions are called cross-origin without a session
// cookie. They must be in publicPaths so the global auth guard lets them
// through before the action route's requiresAuth: false check can fire.
export default createAuthPlugin({
  publicPaths: [
    "/_agent-native/actions/capture-profile",
    "/_agent-native/actions/get-draft",
    "/_agent-native/actions/mark-sent",
    "/_agent-native/actions/check-already-contacted",
  ],
});
