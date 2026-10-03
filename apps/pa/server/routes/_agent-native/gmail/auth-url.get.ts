// Starts "Connect Gmail" (D96): the signed-in person grants PA the
// gmail.compose scope for their own mailbox, so PA can send or save drafts
// as them when they approve. Pattern: prospecting-hub's Google connect route.
import {
  encodeOAuthState,
  getAppUrl,
  getSession,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";

import { GMAIL_SCOPES } from "../../../lib/gmail.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Sign in to PA before connecting Gmail." };
  }
  // guard:allow-env-credential — this workspace's own Google OAuth app registration (client id), not a per-user credential
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    setResponseStatus(event, 503);
    return { error: "Google sign-in is not set up on this server." };
  }
  const redirectUri = getAppUrl(event, "/_agent-native/gmail/callback");
  const state = encodeOAuthState({
    redirectUri,
    owner: session.email,
    addAccount: true,
    app: "pa",
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    // Google picks the right account when the person has several.
    login_hint: session.email,
    state,
  });
  const url = `${GOOGLE_AUTH_URL}?${params}`;
  if (getQuery(event).redirect === "1")
    return new Response(null, { status: 302, headers: { Location: url } });
  return { url };
});
