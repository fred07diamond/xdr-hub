import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const NOOKS_API_BASE = "https://partner-api.nooks.in/v1";
const NOOKS_TOKEN_URL = "https://oauth.nooks.in/oauth/token";
const NOOKS_TOKEN_TIMEOUT_MS = 20_000;

interface DecodedClaims {
  scope: string | null;
  exp: number | null;
  iat: number | null;
}

function decodeJwtClaims(token: string): DecodedClaims {
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) throw new Error("token is not a 3-part JWT");
  const json = Buffer.from(
    payloadSegment.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  const claims = JSON.parse(json) as { scope?: string; exp?: number; iat?: number };
  return {
    scope: claims.scope ?? null,
    exp: claims.exp ?? null,
    iat: claims.iat ?? null,
  };
}

async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string } | null> {
  const clientId = process.env.NOOKS_CLIENT_ID;
  const clientSecret = process.env.NOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch(NOOKS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(NOOKS_TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) return null;
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

// Temporary diagnostic -- not for product use. Answers, with a single
// end-to-end run so the token used to decode claims is provably the same
// token used to make the requests below: is coaching:read/teams:read
// actually present in the live token, and if so, do /calls/{id}/transcript
// and ?include=transcript still 403 anyway (entitlement gate) or succeed
// (meaning the earlier 403s were a stale-token artifact)? Admin-only.
// Accepts an optional callId to test against a call this token's own
// /calls list doesn't return -- always in its own labeled block so it's
// never confused with what the token can see on its own. Delete once
// answered.
export default defineAction({
  description: "[diagnostic] Ground-truth check of the Nooks token and calls/transcript endpoints.",
  schema: z.object({
    // Optional: an externally-sourced call ID to also probe, kept separate
    // from and clearly labeled apart from whatever this token's own /calls
    // list returns, so the two pieces of evidence are never conflated.
    callId: z.string().optional(),
  }),
  requiresAuth: true,
  readOnly: true,
  agentTool: false,
  http: { method: "GET" },
  run: async ({ callId: externalCallId }, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);

    const accounts = await getOAuthAccounts("nooks", ctx!.userEmail);
    const account = accounts[0];
    if (!account?.tokens?.access_token && !account?.tokens?.refresh_token) {
      throw new Error("Nooks not connected for this user.");
    }

    let token = account.tokens.access_token as string | undefined;
    let refreshToken = account.tokens.refresh_token as string | undefined;
    let refreshed = false;
    let refreshError: string | null = null;

    let claims: DecodedClaims | null = null;
    if (token) {
      try {
        claims = decodeJwtClaims(token);
      } catch {
        claims = null;
      }
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const isExpired = !claims || !claims.exp || claims.exp <= nowSeconds;

    if (isExpired && refreshToken) {
      const result = await refreshAccessToken(refreshToken).catch((err) => {
        refreshError = err instanceof Error ? err.message : String(err);
        return null;
      });
      if (result) {
        token = result.access_token;
        refreshToken = result.refresh_token ?? refreshToken;
        refreshed = true;
        await saveOAuthTokens(
          "nooks",
          account.accountId as string,
          { ...account.tokens, access_token: result.access_token, refresh_token: refreshToken },
          ctx!.userEmail,
        );
        try {
          claims = decodeJwtClaims(token);
        } catch {
          claims = null;
        }
      } else if (!refreshError) {
        refreshError = "refresh request returned non-OK status";
      }
    }

    if (!token) {
      return {
        tokenScope: null,
        tokenExp: null,
        refreshed,
        refreshError,
        results: [],
      };
    }

    const headers = { Authorization: `Bearer ${token}` };

    async function probe(label: string, path: string) {
      const res = await fetch(`${NOOKS_API_BASE}${path}`, {
        headers,
        signal: AbortSignal.timeout(NOOKS_TOKEN_TIMEOUT_MS),
      });
      const body = await res.text();
      return { label, path, status: res.status, body: body.slice(0, 1500) };
    }

    const results: Array<{ label: string; path: string | null; status: number | null; body?: string; note?: string }> = [];

    const listResult = await probe("list-calls", "/calls?page[size]=1");
    results.push(listResult);

    let firstCallId: string | undefined;
    try {
      const parsed = JSON.parse(listResult.body) as { data?: Array<{ id: string }> };
      firstCallId = parsed.data?.[0]?.id;
    } catch {
      // leave undefined
    }

    if (firstCallId) {
      results.push(await probe("own-list:call-detail", `/calls/${firstCallId}`));
      results.push(await probe("own-list:transcript-sub-resource", `/calls/${firstCallId}/transcript`));
      results.push(await probe("own-list:call-detail-include-transcript", `/calls/${firstCallId}?include=transcript`));
    } else {
      results.push({ label: "own-list:call-detail", path: null, status: null, note: "no call id returned by list-calls" });
      results.push({ label: "own-list:transcript-sub-resource", path: null, status: null, note: "no call id returned by list-calls" });
      results.push({ label: "own-list:call-detail-include-transcript", path: null, status: null, note: "no call id returned by list-calls" });
    }

    // Externally-sourced ID (not discovered by this token's own /calls list)
    // -- kept in its own labeled block so it's never mistaken for evidence
    // about what this token/account can itself see.
    if (externalCallId) {
      results.push(await probe("external-id:call-detail", `/calls/${externalCallId}`));
      results.push(await probe("external-id:transcript-sub-resource", `/calls/${externalCallId}/transcript`));
      results.push(
        await probe("external-id:call-detail-include-transcript", `/calls/${externalCallId}?include=transcript`),
      );
    }

    return {
      tokenScope: claims?.scope ?? null,
      tokenExp: claims?.exp ?? null,
      tokenIat: claims?.iat ?? null,
      refreshed,
      refreshError,
      results,
    };
  },
});
