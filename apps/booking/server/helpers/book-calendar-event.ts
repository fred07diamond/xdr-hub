import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1";
const MEETING_DURATION_MIN = 45;

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

// Creates the booked meeting directly on the XDR's Google Calendar (primary),
// using their stored Google OAuth connection. Requires the calendar.events
// scope — users who connected before that scope was added must reconnect in
// Settings.
export async function bookCalendarEvent({
  title,
  datetime,
  prospectEmail,
  aeEmail,
  xdrEmail,
  description,
}: {
  title: string;
  datetime: string;
  prospectEmail?: string;
  aeEmail: string;
  xdrEmail: string;
  description: string;
}): Promise<{ eventId: string; meetingLink: string }> {
  const start = new Date(datetime);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Calendar booking failed: invalid meeting datetime "${datetime}"`);
  }
  const end = new Date(start.getTime() + MEETING_DURATION_MIN * 60 * 1000);

  const accounts = await getOAuthAccounts("google", xdrEmail);
  const account = accounts[0];
  let token = account?.tokens?.access_token as string | undefined;
  const refreshToken = account?.tokens?.refresh_token as string | undefined;
  if (!token) {
    throw new Error(
      "Calendar booking failed: no Google Calendar connection. Connect Google Calendar in Settings.",
    );
  }

  const attendees = [aeEmail, xdrEmail, ...(prospectEmail ? [prospectEmail] : [])]
    .filter(Boolean)
    .map((email) => ({ email }));

  const body = JSON.stringify({
    summary: title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees,
    conferenceData: {
      createRequest: {
        requestId: `xdr-booking-${start.getTime()}-${xdrEmail.split("@")[0]}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  });

  const createEvent = (accessToken: string) =>
    fetch(CALENDAR_EVENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });

  let res = await createEvent(token);

  if (res.status === 401 && refreshToken) {
    const newToken = await refreshAccessToken(refreshToken);
    if (newToken) {
      await saveOAuthTokens(
        "google",
        (account!.accountId as string) ?? xdrEmail,
        { ...account!.tokens, access_token: newToken },
        xdrEmail,
      );
      token = newToken;
      res = await createEvent(newToken);
    }
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Calendar booking failed: Google Calendar connection lacks write access. Reconnect Google Calendar in Settings to grant it.",
    );
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Calendar booking failed (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    htmlLink?: string;
  };
  return {
    eventId: data.id ?? "",
    meetingLink: data.hangoutLink ?? data.htmlLink ?? "",
  };
}
