import { defineEventHandler, getQuery } from "h3";
import {
  getSession,
  oauthCallbackResponse,
  oauthErrorPage,
} from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";
import { verifyNooksState } from "../../../helpers/nooks-oauth-state.js";

const NOOKS_TOKEN_URL = "https://oauth.nooks.in/oauth/token";
const NOOKS_ME_URL = "https://partner-api.nooks.in/v1/me";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const session = await getSession(event).catch(() => null);

  if (typeof query.error === "string") {
    const desc =
      typeof query.error_description === "string" ? query.error_description : query.error;
    return oauthErrorPage(`Nooks authorization failed: ${desc}`);
  }

  const state = verifyNooksState(
    typeof query.state === "string" ? query.state : undefined,
  );
  if (!state) return oauthErrorPage("Invalid or expired sign-in state. Try again.");

  const code = typeof query.code === "string" ? query.code : null;
  if (!code) return oauthErrorPage("Missing authorization code.");

  const ownerEmail = session?.email ?? state.owner;
  if (!ownerEmail) return oauthErrorPage("Session expired. Sign in and try again.");

  // guard:allow-env-credential — this workspace's own Nooks OAuth app registration (client id), not a per-user credential
  const clientId = process.env.NOOKS_CLIENT_ID;
  // guard:allow-env-credential — same OAuth app registration as above
  const clientSecret = process.env.NOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage("Nooks OAuth credentials are not configured.");
  }

  try {
    const tokenRes = await fetch(NOOKS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: state.redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: state.verifier,
      }),
    });
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      throw new Error(
        (tokens.error_description as string) || (tokens.error as string) || "Token exchange failed",
      );
    }

    const meRes = await fetch(NOOKS_ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = (await meRes.json()) as { email?: string | null };
    const email = me.email ?? ownerEmail;

    await saveOAuthTokens("nooks", email, tokens, ownerEmail);

    return oauthCallbackResponse(event, email, {
      addAccount: true,
      appName: "XDR Booking",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return oauthErrorPage(`Nooks connection failed: ${msg}`);
  }
});
