import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_CREATE_MEETING_URL = "https://api.zoom.us/v2/users/me/meetings";

// Zoom rotates refresh tokens: every refresh invalidates the old one, so the
// full new token set must be persisted immediately or the connection breaks.
async function refreshZoomTokens(
  refreshToken: string,
): Promise<Record<string, unknown> | null> {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

// Creates a unique scheduled Zoom meeting on the user's connected Zoom
// account and returns its join URL.
export async function createZoomMeeting({
  ownerEmail,
  topic,
  startIso,
  durationMinutes,
}: {
  ownerEmail: string;
  topic: string;
  startIso: string;
  durationMinutes: number;
}): Promise<{ joinUrl: string }> {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Zoom meeting failed: invalid start time "${startIso}"`);
  }

  const accounts = await getOAuthAccounts("zoom", ownerEmail);
  const account = accounts[0];
  let token = account?.tokens?.access_token as string | undefined;
  const refreshToken = account?.tokens?.refresh_token as string | undefined;
  if (!token) {
    throw new Error("Zoom is not connected. Connect Zoom in Settings first.");
  }

  const body = JSON.stringify({
    topic,
    type: 2, // scheduled meeting
    start_time: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: durationMinutes,
    timezone: "UTC",
  });

  const createMeeting = (accessToken: string) =>
    fetch(ZOOM_CREATE_MEETING_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });

  let res = await createMeeting(token);

  if (res.status === 401 && refreshToken) {
    const newTokens = await refreshZoomTokens(refreshToken);
    if (newTokens?.access_token) {
      await saveOAuthTokens(
        "zoom",
        (account!.accountId as string) ?? ownerEmail,
        { ...account!.tokens, ...newTokens },
        ownerEmail,
      );
      token = newTokens.access_token as string;
      res = await createMeeting(token);
    }
  }

  if (res.status === 401) {
    throw new Error(
      "Zoom connection expired. Reconnect Zoom in Settings and try again.",
    );
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `Zoom meeting failed (${res.status}): ${errBody.message ?? "unknown error"}`,
    );
  }

  const data = (await res.json()) as { join_url?: string };
  if (!data.join_url) {
    throw new Error("Zoom meeting created but no join URL was returned.");
  }
  return { joinUrl: data.join_url };
}
