import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import {
  encodeOAuthState,
  getAppUrl,
  getSession,
} from "@agent-native/core/server";

const ZOOM_AUTH_URL = "https://zoom.us/oauth/authorize";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Must be signed in to connect Zoom." };
  }

  // guard:allow-env-credential — this workspace's own Zoom OAuth app registration (client id), not a per-user credential
  const clientId = process.env.ZOOM_CLIENT_ID;
  if (!clientId) {
    setResponseStatus(event, 503);
    return {
      error:
        "Zoom OAuth is not configured — set ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.",
    };
  }

  // App-mounted callback (keeps the /booking base path) — must be registered
  // as the Zoom OAuth app's redirect URL.
  const redirectUri = getAppUrl(event, "/_agent-native/zoom/callback");

  const q = getQuery(event);
  const state = encodeOAuthState({
    redirectUri,
    owner: session.email,
    addAccount: true,
    app: "booking",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });

  const url = `${ZOOM_AUTH_URL}?${params}`;
  if (q.redirect === "1") {
    return new Response(null, { status: 302, headers: { Location: url } });
  }
  return { url };
});
