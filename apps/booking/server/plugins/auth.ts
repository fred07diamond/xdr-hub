import { createAuthPlugin } from "@agent-native/core/server";

// All actions require auth — no public action paths in v1.
// Domain restriction (@builder.io) is enforced in server/middleware/auth.ts.
// googleScopes requests calendar access — requires GOOGLE_CLIENT_ID/SECRET in .env
// and http://localhost:8080/_agent-native/google/callback in authorized redirect URIs.
export default createAuthPlugin({
  googleScopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
  ],
});
