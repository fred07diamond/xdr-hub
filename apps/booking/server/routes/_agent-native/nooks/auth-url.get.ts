import crypto from "node:crypto";
import { defineEventHandler, getQuery, setResponseStatus } from "h3";
import { getAppUrl, getSession } from "@agent-native/core/server";
import { signNooksState } from "../../../helpers/nooks-oauth-state.js";

const NOOKS_AUTHORIZE_URL = "https://oauth.nooks.in/oauth/authorize";
const NOOKS_SCOPES = "calls:read call-dispositions:read coaching:read teams:read";

export default defineEventHandler(async (event) => {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    setResponseStatus(event, 401);
    return { error: "Must be signed in to connect Nooks." };
  }

  // guard:allow-env-credential — this workspace's own Nooks OAuth app registration (client id), not a per-user credential
  const clientId = process.env.NOOKS_CLIENT_ID;
  if (!clientId) {
    setResponseStatus(event, 503);
    return {
      error: "Nooks OAuth is not configured — set NOOKS_CLIENT_ID and NOOKS_CLIENT_SECRET.",
    };
  }

  const redirectUri = getAppUrl(event, "/_agent-native/nooks/callback");

  // PKCE (required by Nooks for all clients).
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const state = signNooksState({
    verifier,
    owner: session.email,
    redirectUri,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: NOOKS_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const url = `${NOOKS_AUTHORIZE_URL}?${params}`;
  const q = getQuery(event);
  if (q.redirect === "1") {
    return new Response(null, { status: 302, headers: { Location: url } });
  }
  return { url };
});
