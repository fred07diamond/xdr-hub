// Finishes "Connect Gmail" (D96). The Gmail account must be the signed-in
// person's own address: PA only ever sends as the person who clicked.
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";
import {
  decodeOAuthState,
  getAppUrl,
  getSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "@agent-native/core/server";
import { defineEventHandler, getQuery } from "h3";

import { GMAIL_PROVIDER, withExpiry } from "../../../lib/gmail.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_TIMEOUT_MS = 20_000;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  if (typeof query.error === "string") {
    const reason =
      typeof query.error_description === "string"
        ? query.error_description
        : query.error;
    return oauthErrorPage(`Google did not connect Gmail: ${reason}`);
  }
  const session = await getSession(event).catch(() => null);
  let state;
  try {
    state = decodeOAuthState(
      typeof query.state === "string" ? query.state : undefined,
      getAppUrl(event, "/_agent-native/gmail/callback"),
    );
  } catch {
    return oauthErrorPage("This Gmail link expired. Try connecting again.");
  }
  const code = typeof query.code === "string" ? query.code : null;
  if (!code) return oauthErrorPage("Google sent no authorization code.");
  const owner = (session?.email ?? state.owner ?? "").toLowerCase();
  if (!owner) return oauthErrorPage("Sign in to PA, then connect Gmail.");
  if (state.owner && state.owner.toLowerCase() !== owner)
    return oauthErrorPage(
      "You signed in as someone else while connecting. Try again.",
    );
  // guard:allow-env-credential — this workspace's own Google OAuth app registration (client id), not a per-user credential
  const clientId = process.env.GOOGLE_CLIENT_ID;
  // guard:allow-env-credential — same OAuth app registration as above
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return oauthErrorPage("Google sign-in is not set up on this server.");
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: state.redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    if (!tokenResponse.ok)
      throw new Error(
        String(tokens.error_description ?? tokens.error ?? "token exchange"),
      );
    const userResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    const user = (await userResponse.json()) as Record<string, unknown>;
    const email = String(user.email ?? "").toLowerCase();
    if (!email) throw new Error("Google did not say which account this is");
    if (email !== owner)
      return oauthErrorPage(
        `That was ${email}. Connect the Gmail for ${owner}, the address you use in PA.`,
      );
    await saveOAuthTokens(GMAIL_PROVIDER, email, withExpiry(tokens), owner);
    return oauthCallbackResponse(event, email, {
      addAccount: true,
      appName: "Product Advocate",
    });
  } catch (error) {
    return oauthErrorPage(
      `Gmail did not connect: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
});
