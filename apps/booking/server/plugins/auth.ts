import { createAuthPlugin } from "@agent-native/core/server";

// All actions require auth — no public action paths in v1.
// Domain restriction (@builder.io) is enforced in server/middleware/auth.ts.
// googleScopes requests calendar access — requires GOOGLE_CLIENT_ID/SECRET in .env
// and http://localhost:8080/_agent-native/google/callback in authorized redirect URIs.
export default createAuthPlugin({
  // Nooks delivers call-logging webhooks (and its save-time test ping)
  // without a session — the global auth guard must let the path through.
  // Authenticity is enforced inside the route via the HMAC signing key.
  publicPaths: ["/nooks-webhook"],
  // Must match google/add-account/auth-url.get.ts's CALENDAR_SCOPES exactly.
  // @agent-native/core mirrors every Google sign-in/session-refresh's token
  // into the same oauth_tokens row book-calendar-event.ts reads from
  // (account.create/update hooks -> mirrorGoogleAccountToOAuthTokens). When
  // this list was read-only-only, any sign-in event silently overwrote a
  // previously write-capable calendar token with a read-only one -- the
  // actual cause of Calendar access "expiring" every ~week (repeated
  // clobbering, not a real Google-side revocation). Keeping both scope
  // lists identical means the mirror can never downgrade a working token.
  googleScopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
});
