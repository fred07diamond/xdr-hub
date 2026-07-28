import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export default defineAction({
  description:
    "Fetch Google Calendar events for the current user using their stored Google OAuth token.",
  schema: z.object({
    from: z.string(),
    to: z.string(),
    calendarEmail: z.string().email().optional(),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ from, to, calendarEmail }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);

    const accounts = await getOAuthAccounts("google", ctx!.userEmail);
    const account = accounts[0];
    let token = account?.tokens?.access_token as string | undefined;
    const refreshToken = account?.tokens?.refresh_token as string | undefined;
    const accountEmail = account?.accountId ?? "unknown";

    console.log("[cal] userEmail=%s accounts=%d accountId=%s hasToken=%s hasRefresh=%s tokenKeys=%s",
      ctx!.userEmail, accounts.length, accountEmail, !!token, !!refreshToken,
      account ? Object.keys(account.tokens ?? {}).join(",") : "none");

    if (!token) {
      return { events: [], connected: false, reason: "no_google_account" as const };
    }

    const calId = calendarEmail ? encodeURIComponent(calendarEmail) : "primary";
    const params = new URLSearchParams({
      timeMin: `${from}T00:00:00Z`,
      timeMax: `${to}T23:59:59Z`,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "200",
    });

    async function fetchEvents(accessToken: string) {
      return fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
    }

    try {
      let res = await fetchEvents(token);
      console.log("[cal] calendar API status=%d calId=%s", res.status, calId);

      // Auto-refresh on 401
      if (res.status === 401 && refreshToken) {
        const newToken = await refreshAccessToken(refreshToken);
        if (newToken) {
          await saveOAuthTokens(
            "google",
            accountEmail,
            { ...account!.tokens, access_token: newToken },
            ctx!.userEmail,
          );
          token = newToken;
          res = await fetchEvents(newToken);
        }
      }

      if (res.status === 401 || res.status === 403) {
        return { events: [], connected: false, reason: "no_calendar_scope" as const };
      }
      if (!res.ok) {
        return { events: [], connected: false, reason: "api_error" as const };
      }

      const data = (await res.json()) as {
        items: Array<{
          id: string;
          summary?: string;
          start: { dateTime?: string; date?: string };
          end: { dateTime?: string; date?: string };
        }>;
      };

      const events = (data.items ?? [])
        .map((e) => ({
          id: e.id,
          title: e.summary ?? "(No title)",
          start: e.start?.dateTime ?? e.start?.date ?? "",
          end: e.end?.dateTime ?? e.end?.date ?? "",
          allDay: !e.start?.dateTime,
        }))
        .filter((e) => e.start && e.end);

      return { events, connected: true, reason: null };
    } catch {
      return { events: [], connected: false, reason: "network_error" as const };
    }
  },
});
