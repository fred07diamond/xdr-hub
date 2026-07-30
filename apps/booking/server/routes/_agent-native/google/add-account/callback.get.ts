import { defineEventHandler, getQuery } from "h3";
import {
  decodeOAuthState,
  getAppUrl,
  getSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const session = await getSession(event).catch(() => null);

  if (typeof query.error === "string") {
    const desc =
      typeof query.error_description === "string"
        ? query.error_description
        : query.error;
    return oauthErrorPage(`Google authorization failed: ${desc}`);
  }

  const state = decodeOAuthState(
    typeof query.state === "string" ? query.state : undefined,
    getAppUrl(event, "/_agent-native/google/add-account/callback"),
  );

  const code = typeof query.code === "string" ? query.code : null;
  if (!code) return oauthErrorPage("Missing authorization code.");

  const ownerEmail = session?.email ?? state.owner;
  if (!ownerEmail) {
    return oauthErrorPage("Session expired. Sign in and try again.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage("Google OAuth credentials are not configured.");
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: state.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      const errMsg =
        (tokens.error_description as string) ||
        (tokens.error as string) ||
        "Token exchange failed";
      throw new Error(errMsg);
    }

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = (await userRes.json()) as Record<string, unknown>;
    const email = user.email as string | undefined;
    if (!email) throw new Error("Could not retrieve email from Google.");

    await saveOAuthTokens("google", email, tokens, ownerEmail);

    return oauthCallbackResponse(event, email, {
      addAccount: true,
      appName: "Booking Agent",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.log("[cb] error: %s", msg);
    return oauthErrorPage(`Connection failed: ${msg}`);
  }
});
