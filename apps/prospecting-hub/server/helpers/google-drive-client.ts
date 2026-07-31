import { getOAuthAccounts } from "@agent-native/core/server";
import { saveOAuthTokens } from "@agent-native/core/oauth-tokens";

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

export function extractGoogleDocId(input: string): string {
  const trimmed = input.trim();
  // Typical share URL: https://docs.google.com/document/d/<ID>/edit
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  return match ? match[1] : trimmed;
}

// Exports a native Google Doc as plain text. Requires the caller to have
// connected Google Drive (Settings > Connections) with drive.readonly scope.
export async function fetchGoogleDocText(docUrlOrId: string, ownerEmail: string): Promise<string> {
  const connection = await getGoogleConnection(ownerEmail);
  if (!connection) {
    throw new Error("Google Drive is not connected. Connect it in Settings first.");
  }
  const fileId = extractGoogleDocId(docUrlOrId);
  const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;

  let { token } = connection;
  const { account, refreshToken } = connection;
  const doFetch = (accessToken: string) =>
    fetch(exportUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

  let res = await doFetch(token);

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
      res = await doFetch(newToken);
    }
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Google Drive connection lacks read access, or doesn't have access to this doc. Reconnect Google Drive in Settings, or share the doc with the connected account.");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Drive export failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const text = await res.text();
  if (!text.trim()) {
    throw new Error("That Google Doc has no readable text, or is not a native Google Doc (PDFs and uploaded Word files can't be exported as plain text this way).");
  }
  return text;
}
