import crypto from "node:crypto";

// Nooks requires authorization-code + PKCE; the framework's encodeOAuthState
// only round-trips its own known fields, so the code_verifier travels in this
// separate HMAC-signed envelope instead.

export interface NooksOAuthState {
  verifier: string;
  owner: string;
  redirectUri: string;
  ts: number;
}

// Deliberately does NOT fall back to A2A_SECRET — that secret is trusted for
// cross-app calls workspace-wide, and reusing it here would mean a compromise
// of one trust boundary weakens the other. OAuth state gets its own secret.
function signingKey(): string {
  const key = process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!key) throw new Error("OAuth state signing requires a server secret.");
  return key;
}

export function signNooksState(state: Omit<NooksOAuthState, "ts">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...state, ts: Date.now() }),
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyNooksState(raw: string | undefined): NooksOAuthState | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", signingKey())
    .update(payload)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as NooksOAuthState;
    // 15-minute validity window for the authorize round-trip.
    if (!parsed.ts || Date.now() - parsed.ts > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
