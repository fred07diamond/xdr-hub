import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  encodeOAuthState,
  getAppUrl,
  getSession,
} from "@agent-native/core/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  // Write access so confirm-workflow can create the booked meeting event.
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Must be signed in to connect Google Calendar." };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    setResponseStatus(event, 503);
    return { error: "Google OAuth is not configured on this server." };
  }

  // Use the app-mounted callback URL (with the /booking base path) instead of
  // resolveOAuthRedirectUri: the workspace OAuth relay would strip the base
  // path, and only the /booking-prefixed URI is registered on the Google
  // OAuth client. The callback route is served directly by this app, so no
  // relay hop is needed.
  const redirectUri = getAppUrl(
    event,
    "/_agent-native/google/add-account/callback",
  );

  const q = getQuery(event);
  const state = encodeOAuthState({
    redirectUri,
    owner: session.email,
    addAccount: true,
    // Must match the workspace app id (apps/booking) — the workspace OAuth
    // callback relay 302s root callbacks to `/<app>` based on this value.
    app: "booking",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const url = `${GOOGLE_AUTH_URL}?${params}`;

  if (q.redirect === "1") {
    return new Response(null, { status: 302, headers: { Location: url } });
  }
  return { url };
});
