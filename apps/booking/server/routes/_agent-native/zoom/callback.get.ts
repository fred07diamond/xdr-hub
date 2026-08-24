import { defineEventHandler, getQuery } from "h3";
import {
  decodeOAuthState,
  getAppUrl,
  getSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_ME_URL = "https://api.zoom.us/v2/users/me";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const session = await getSession(event).catch(() => null);

  if (typeof query.error === "string") {
    return oauthErrorPage(`Zoom authorization failed: ${query.error}`);
  }

  const state = decodeOAuthState(
    typeof query.state === "string" ? query.state : undefined,
    getAppUrl(event, "/_agent-native/zoom/callback"),
  );

  const code = typeof query.code === "string" ? query.code : null;
  if (!code) return oauthErrorPage("Missing authorization code.");

  const ownerEmail = session?.email ?? state.owner;
  if (!ownerEmail) {
    return oauthErrorPage("Session expired. Sign in and try again.");
  }

  // guard:allow-env-credential — this workspace's own Zoom OAuth app registration (client id), not a per-user credential
  const clientId = process.env.ZOOM_CLIENT_ID;
  // guard:allow-env-credential — same OAuth app registration as above
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage("Zoom OAuth credentials are not configured.");
  }

  try {
    const tokenRes = await fetch(ZOOM_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: state.redirectUri,
      }),
    });
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      throw new Error(
        (tokens.reason as string) || (tokens.error as string) || "Token exchange failed",
      );
    }

    const meRes = await fetch(ZOOM_ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = (await meRes.json()) as Record<string, unknown>;
    const email = (me.email as string | undefined) ?? ownerEmail;

    await saveOAuthTokens("zoom", email, tokens, ownerEmail);

    return oauthCallbackResponse(event, email, {
      addAccount: true,
      appName: "XDR Booking",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return oauthErrorPage(`Zoom connection failed: ${msg}`);
  }
});
