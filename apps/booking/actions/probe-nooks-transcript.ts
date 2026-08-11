import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const NOOKS_API_BASE = "https://partner-api.nooks.in/v1";
const NOOKS_TOKEN_URL = "https://oauth.nooks.in/oauth/token";
const NOOKS_TOKEN_TIMEOUT_MS = 20_000;

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

// A real call known (via a different channel) to have hasTranscript: true,
// used as a fallback when this token's /calls list comes back empty.
const KNOWN_CALL_ID_FALLBACK = "00004e92-e92e-472c-8701-8c294271ebd8";

// Temporary diagnostic — not for product use. Answers one question: does the
// connected user's OAuth token (scopes calls:read, call-dispositions:read,
// coaching:read, teams:read) expose transcript TEXT anywhere — a documented
// field, an undocumented /transcript sub-resource, or an undocumented
// coaching/teams endpoint — or only transcriptUrl (a link into the Nooks web
// app)? Admin-only. Delete once answered.
export default defineAction({
  description: "[diagnostic] Probe Nooks endpoints (including undocumented ones) for transcript access.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  agentTool: false,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);

    const accounts = await getOAuthAccounts("nooks", ctx!.userEmail);
    const account = accounts[0];
    const refreshToken = account?.tokens?.refresh_token as string | undefined;
    if (!account?.tokens?.access_token && !refreshToken) {
      throw new Error("Nooks not connected for this user.");
    }

    let token = account?.tokens?.access_token as string | undefined;
    let refreshed = false;
    if (refreshToken) {
      const refreshResult = await refreshAccessToken(refreshToken);
      if (refreshResult) {
        token = refreshResult.access_token;
        refreshed = true;
        await saveOAuthTokens(
          "nooks",
          account!.accountId as string,
          {
            ...account!.tokens,
            access_token: refreshResult.access_token,
            // Nooks rotates refresh tokens on every use and invalidates the
            // old one immediately -- keep it in sync or every subsequent
            // refresh silently fails.
            refresh_token: refreshResult.refresh_token ?? refreshToken,
          },
          ctx!.userEmail,
        );
      }
    }
    if (!token) throw new Error("Nooks token refresh failed and no access token was stored.");
    const headers = { Authorization: `Bearer ${token}` };

    async function probe(label: string, path: string) {
      const res = await fetch(`${NOOKS_API_BASE}${path}`, { headers });
      const body = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // leave null, report raw below
      }
      return {
        label,
        path,
        status: res.status,
        fieldNames:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed as Record<string, unknown>)
            : null,
        body: body.slice(0, 1500),
      };
    }

    const listRes = await fetch(`${NOOKS_API_BASE}/calls?page[size]=5`, {
      headers,
    }).catch(() => null);
    const listBody = listRes ? await listRes.text() : "";
    let firstCallId: string | undefined;
    let usedFallbackCallId = false;
    if (listRes?.ok) {
      try {
        const list = JSON.parse(listBody) as { data?: Array<{ id: string }> };
        firstCallId = list.data?.[0]?.id;
      } catch {
        // ignore
      }
    }
    if (!firstCallId) {
      firstCallId = KNOWN_CALL_ID_FALLBACK;
      usedFallbackCallId = true;
    }

    const results = await Promise.all([
      probe("list-calls", "/calls?page[size]=5"),
      firstCallId
        ? probe("call-detail", `/calls/${firstCallId}`)
        : Promise.resolve({ label: "call-detail", path: null, status: null, note: "no call id from list" }),
      firstCallId
        ? probe("call-detail with include=transcript", `/calls/${firstCallId}?include=transcript`)
        : Promise.resolve({ label: "call-detail with include=transcript", path: null, status: null }),
      firstCallId
        ? probe("transcript sub-resource", `/calls/${firstCallId}/transcript`)
        : Promise.resolve({ label: "transcript sub-resource", path: null, status: null }),
      probe("teams", "/teams"),
      probe("coaching", "/coaching"),
      firstCallId ? probe("coaching for call", `/coaching/calls/${firstCallId}`) : Promise.resolve({ label: "coaching for call", path: null, status: null }),
      probe("desktop-notes", "/desktopNotes"),
    ]);

    return { refreshed, firstCallId, usedFallbackCallId, results };
  },
});
