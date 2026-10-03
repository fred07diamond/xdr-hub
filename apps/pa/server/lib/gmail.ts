// Sending from the lead owner's own Gmail (D96). Each person connects their
// Gmail once; the tokens live in the framework's oauth_tokens table under
// their email and never leave the server. One scope, gmail.compose, covers
// both "Approve and send" (messages.send) and "Approve" (drafts.create).
import {
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";

/** Its own provider id, so Google sign-in tokens never overwrite it. */
export const GMAIL_PROVIDER = "pa_gmail";
export const GMAIL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  // The person's name, to sign drafts written before the owner was known (D98).
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.compose",
];
const COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
// Every Google call is timed: an untimed token refresh after a quiet day
// hung whole pages in a sibling app (prospecting-hub google-drive-client).
const GOOGLE_TIMEOUT_MS = 20_000;

export class GmailError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_connected"
      | "reconnect"
      | "not_configured"
      | "gmail_refused",
  ) {
    super(message);
    this.name = "GmailError";
  }
}

function oauthClient() {
  // guard:allow-env-credential — this workspace's own Google OAuth app registration (client id/secret), not a per-user credential
  const clientId = process.env.GOOGLE_CLIENT_ID;
  // guard:allow-env-credential — same OAuth app registration as above
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function gmailConfigured() {
  return oauthClient() !== null;
}

/** Stamps when the access token expires, so it is refreshed before use. */
export function withExpiry(tokens: Record<string, unknown>, at = Date.now()) {
  const expiresIn = Number(tokens.expires_in ?? 0);
  return expiresIn > 0
    ? { ...tokens, expires_at: at + expiresIn * 1000 }
    : { ...tokens };
}

async function connectionOf(owner: string) {
  const accounts = await listOAuthAccountsByOwner(
    GMAIL_PROVIDER,
    owner.toLowerCase(),
  );
  return (
    accounts.find(
      (account) =>
        account.accountId.toLowerCase() === owner.toLowerCase() &&
        typeof account.tokens.access_token === "string",
    ) ?? null
  );
}

export interface GmailStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  /** Connected, but without the compose scope: connect again. */
  needsReconnect: boolean;
}

export async function gmailStatus(owner: string): Promise<GmailStatus> {
  const account = await connectionOf(owner);
  const scope = String(account?.tokens.scope ?? "");
  return {
    configured: gmailConfigured(),
    connected: Boolean(account),
    email: account?.accountId ?? null,
    needsReconnect: Boolean(account) && !scope.includes(COMPOSE_SCOPE),
  };
}

/** A usable access token for the owner's Gmail, refreshed when close to expiry. */
export async function gmailAccessToken(owner: string): Promise<string> {
  const account = await connectionOf(owner);
  if (!account)
    throw new GmailError(
      "Connect your Gmail first, so PA can send as you.",
      "not_connected",
    );
  const tokens = account.tokens;
  if (!String(tokens.scope ?? "").includes(COMPOSE_SCOPE))
    throw new GmailError(
      "Your Gmail connection cannot send or save drafts. Connect Gmail again.",
      "reconnect",
    );
  const expiresAt = Number(tokens.expires_at ?? 0);
  if (expiresAt && expiresAt > Date.now() + 60_000)
    return tokens.access_token as string;
  const refreshToken = tokens.refresh_token;
  const client = oauthClient();
  if (!client)
    throw new GmailError(
      "Google sign-in is not set up on this server.",
      "not_configured",
    );
  if (typeof refreshToken !== "string" || !refreshToken)
    throw new GmailError(
      "Your Gmail connection expired. Connect Gmail again.",
      "reconnect",
    );
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok || typeof data.access_token !== "string")
    throw new GmailError(
      "Google would not renew your Gmail connection. Connect Gmail again.",
      "reconnect",
    );
  await saveOAuthTokens(
    GMAIL_PROVIDER,
    account.accountId,
    withExpiry({ ...tokens, ...data, refresh_token: refreshToken }),
    owner.toLowerCase(),
  );
  return data.access_token;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  cc: string | null;
  subject: string;
  body: string;
}

/** Header values never carry line breaks, so nothing can add a header. */
const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function encodeHeader(value: string) {
  const safe = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(safe)
    ? safe
    : `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

/** The email as RFC 2822 text, base64url encoded for the Gmail API. */
export function buildRawEmail(email: OutgoingEmail): string {
  const body = Buffer.from(email.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  const lines = [
    `From: ${headerSafe(email.from)}`,
    `To: ${headerSafe(email.to)}`,
    ...(email.cc ? [`Cc: ${headerSafe(email.cc)}`] : []),
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function gmailPost(token: string, path: string, payload: unknown) {
  const response = await fetch(`${GMAIL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    const reason = String(data?.error?.message ?? `HTTP ${response.status}`);
    throw new GmailError(
      response.status === 401 || response.status === 403
        ? `Gmail refused: ${reason}. Connect Gmail again.`
        : `Gmail refused: ${reason}`,
      response.status === 401 || response.status === 403
        ? "reconnect"
        : "gmail_refused",
    );
  }
  return data;
}

export interface GmailClient {
  /** The connected person's first name from Google, saved when they connected. */
  firstName(owner: string): Promise<string | null>;
  send(owner: string, email: OutgoingEmail): Promise<{ id: string }>;
  saveDraft(owner: string, email: OutgoingEmail): Promise<{ id: string }>;
}

export const gmailClient: GmailClient = {
  async firstName(owner) {
    const account = await connectionOf(owner);
    const name = account?.tokens.given_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  },
  async send(owner, email) {
    const token = await gmailAccessToken(owner);
    const data = await gmailPost(token, "/messages/send", {
      raw: buildRawEmail(email),
    });
    return { id: String(data.id ?? "") };
  },
  async saveDraft(owner, email) {
    const token = await gmailAccessToken(owner);
    const data = await gmailPost(token, "/drafts", {
      message: { raw: buildRawEmail(email) },
    });
    return { id: String(data.id ?? "") };
  },
};
