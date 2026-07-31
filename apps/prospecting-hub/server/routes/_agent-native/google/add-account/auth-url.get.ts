import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  encodeOAuthState,
  getAppUrl,
  getSession,
} from "@agent-native/core/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Read-only: this app only ever reads persona doc content, never writes to Drive.
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Must be signed in to connect Google Drive." };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    setResponseStatus(event, 503);
    return { error: "Google OAuth is not configured on this server." };
  }

  const redirectUri = getAppUrl(
    event,
    "/_agent-native/google/add-account/callback",
  );

  const q = getQuery(event);
  const state = encodeOAuthState({
    redirectUri,
    owner: session.email,
    addAccount: true,
    app: "prospecting-hub",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
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
