import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// sendUpdates=all makes Google email the invite to attendees on create/change.
const CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all";
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

async function getGoogleConnection(email: string) {
  const accounts = await getOAuthAccounts("google", email);
  const account = accounts[0];
  const token = account?.tokens?.access_token as string | undefined;
  if (!token) return null;
  return {
    email,
    account,
    token,
    refreshToken: account?.tokens?.refresh_token as string | undefined,
  };
}

// Creates the booked meeting on the AE's Google Calendar when the AE has
// connected Google in Settings — the AE must be the event owner so Gong
// (which watches AE calendars) picks the call up. Falls back to the XDR's
// connection when the AE hasn't connected. Requires the calendar.events
// scope — users who connected before that scope was added must reconnect.
export async function bookCalendarEvent({
  title,
  datetime,
  prospectEmail,
  aeEmail,
  xdrEmail,
  description,
  existingEventId,
  customMeetingLink,
}: {
  title: string;
  datetime: string;
  prospectEmail?: string;
  aeEmail: string;
  xdrEmail: string;
  description: string;
  /** When set, updates this event in place instead of creating a new one. */
  existingEventId?: string | null;
  /** External conferencing link (e.g. Zoom). Skips Google Meet creation. */
  customMeetingLink?: string | null;
}): Promise<{ eventId: string; meetingLink: string; ownerEmail: string }> {
  const start = new Date(datetime);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Calendar booking failed: invalid meeting datetime "${datetime}"`);
  }
  const end = new Date(start.getTime() + MEETING_DURATION_MIN * 60 * 1000);

  // AE first: the AE must own the event for Gong to track the call.
  const connection =
    (aeEmail ? await getGoogleConnection(aeEmail) : null) ??
    (await getGoogleConnection(xdrEmail));
  if (!connection) {
    throw new Error(
      "Calendar booking failed: no Google Calendar connection. Connect Google Calendar in Settings.",
    );
  }
  const { account, refreshToken, email: ownerEmail } = connection;
  let token: string | undefined = connection.token;

  const attendees = [aeEmail, xdrEmail, ...(prospectEmail ? [prospectEmail] : [])]
    .filter(Boolean)
    .map((email) => ({ email }));

  const meetCreateRequest = {
    requestId: `xdr-booking-${start.getTime()}-${Date.now()}`,
    conferenceSolutionKey: { type: "hangoutsMeet" as const },
  };
  const eventFields = {
    summary: title,
    description: customMeetingLink
      ? `Join: ${customMeetingLink}\n\n${description}`
      : description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees,
    // Custom link (Zoom, etc.) lives in location; cleared when back on Meet.
    location: customMeetingLink ?? "",
  };
  // With a custom link the link IS the conference — no Meet.
  const insertBody = JSON.stringify(
    customMeetingLink
      ? eventFields
      : { ...eventFields, conferenceData: { createRequest: meetCreateRequest } },
  );

  const sendEvent = async (accessToken: string) => {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    if (existingEventId) {
      const eventUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingEventId)}`;
      // Conferencing on patch: Zoom → strip any Meet; Meet → create one only
      // if the event doesn't already have a conference.
      const patch: Record<string, unknown> = { ...eventFields };
      if (customMeetingLink) {
        patch.conferenceData = null;
      } else {
        const getRes = await fetch(eventUrl, { headers });
        if (getRes.ok) {
          const existing = (await getRes.json()) as { conferenceData?: unknown };
          if (!existing.conferenceData) {
            patch.conferenceData = { createRequest: meetCreateRequest };
          }
        }
      }
      const patchRes = await fetch(
        `${eventUrl}?conferenceDataVersion=1&sendUpdates=all`,
        { method: "PATCH", headers, body: JSON.stringify(patch) },
      );
      // Event was deleted in Google — fall through to creating a fresh one.
      if (patchRes.status !== 404 && patchRes.status !== 410) return patchRes;
    }
    return fetch(CALENDAR_EVENTS_URL, { method: "POST", headers, body: insertBody });
  };

  let res = await sendEvent(token);

  if (res.status === 401 && refreshToken) {
    const newToken = await refreshAccessToken(refreshToken);
    if (newToken) {
      await saveOAuthTokens(
        "google",
        (account!.accountId as string) ?? ownerEmail,
        { ...account!.tokens, access_token: newToken },
        ownerEmail,
      );
      token = newToken;
      res = await sendEvent(newToken);
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
    meetingLink: customMeetingLink ?? data.hangoutLink ?? data.htmlLink ?? "",
    ownerEmail,
  };
}
