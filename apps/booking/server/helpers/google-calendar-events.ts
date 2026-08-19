import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// A Google access token is only good for ~1hr, so any request made after the
// app has sat idle for a day always hits this refresh path -- see
// get-calendar-events.ts's original comment for the untimed-fetch incident
// this timeout fixed.
const GOOGLE_TOKEN_TIMEOUT_MS = 20_000;

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
    signal: AbortSignal.timeout(GOOGLE_TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[google-calendar-events] token refresh failed (${res.status}): ${body.slice(0, 300)}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export type CalendarFetchReason = "no_google_account" | "no_calendar_scope" | "api_error" | "network_error" | null;

export interface CalendarFetchResult {
  events: CalendarEvent[];
  connected: boolean;
  reason: CalendarFetchReason;
}

// Shared by get-calendar-events.ts (the Calendar tab) and
// get-ae-availability.ts (the AE time-slot picker) -- fetches events for
// `calendarEmail` (default: the caller's own "primary") using the CALLER's
// (ownerEmail's) own stored Google OAuth token. Only sees another person's
// calendar if it's actually shared with the caller's Google account --
// callers should treat "no_calendar_scope" as "can't view this calendar"
// rather than a generic connection failure.
export async function fetchCalendarEvents({
  ownerEmail,
  from,
  to,
  calendarEmail,
}: {
  ownerEmail: string;
  from: string;
  to: string;
  calendarEmail?: string;
}): Promise<CalendarFetchResult> {
  const accounts = await getOAuthAccounts("google", ownerEmail);
  const account = accounts[0];
  let token = account?.tokens?.access_token as string | undefined;
  const refreshToken = account?.tokens?.refresh_token as string | undefined;
  const accountEmail = account?.accountId ?? "unknown";

  if (!token) {
    return { events: [], connected: false, reason: "no_google_account" };
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

    if (res.status === 401 && refreshToken) {
      const newToken = await refreshAccessToken(refreshToken);
      if (newToken) {
        await saveOAuthTokens(
          "google",
          accountEmail,
          { ...account!.tokens, access_token: newToken },
          ownerEmail,
        );
        token = newToken;
        res = await fetchEvents(newToken);
      }
    }

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      console.error(`[google-calendar-events] events fetch failed after refresh (${res.status}) for ${accountEmail}: ${body.slice(0, 300)}`);
      return { events: [], connected: false, reason: "no_calendar_scope" };
    }
    if (!res.ok) {
      return { events: [], connected: false, reason: "api_error" };
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
    return { events: [], connected: false, reason: "network_error" };
  }
}
