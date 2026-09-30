// The minute poll's request signature (D58): HMAC-SHA256 over the timestamp
// with the workspace's A2A secret, fresh within five minutes. Only the
// scheduled function and the PA route know the secret.
import crypto from "node:crypto";

export const POLL_MAX_AGE_MS = 5 * 60_000;

export function signPoll(secret: string, timestamp: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`pa-intake-poll.${timestamp}`)
    .digest("hex");
}

export function verifyPoll(input: {
  secret: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  now: number;
}): boolean {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  const at = Number(input.timestamp);
  if (!Number.isFinite(at) || Math.abs(input.now - at) > POLL_MAX_AGE_MS)
    return false;
  const expected = signPoll(input.secret, input.timestamp);
  return (
    expected.length === input.signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature))
  );
}
