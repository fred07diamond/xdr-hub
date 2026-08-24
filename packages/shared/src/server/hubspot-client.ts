import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestOrgId } from "@agent-native/core/server";
import { withTimeout } from "./timeout.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

export async function getHubSpotToken(): Promise<string | null> {
  const orgId = getRequestOrgId();
  if (orgId) {
    const stored = await readAppSecret({ key: "HUBSPOT_ACCESS_TOKEN", scope: "org", scopeId: orgId });
    if (stored?.value) return stored.value;
  }
  return process.env.HUBSPOT_ACCESS_TOKEN ?? null;
}

async function hubspotFetchWithToken(
  token: string,
  path: string,
  options?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body) as { message?: string };
      message = parsed.message ?? body;
    } catch { /* use raw body */ }
    if (res.status === 401) {
      throw new Error("Invalid token — make sure you're using a HubSpot Private App token (starts with pat-), not an API key.");
    }
    throw new Error(`HubSpot error (${res.status}): ${message}`);
  }
  return res.json();
}

export async function hubspotFetch(path: string, options?: RequestInit): Promise<unknown> {
  const token = await getHubSpotToken();
  if (!token) {
    throw new Error("HubSpot not connected. Set HUBSPOT_ACCESS_TOKEN in your environment.");
  }
  return hubspotFetchWithToken(token, path, options);
}

export async function hubspotFetchIfConnected(
  path: string,
  options?: RequestInit,
): Promise<{ token: string; data: unknown } | null> {
  const token = await getHubSpotToken();
  if (!token) return null;
  const data = await hubspotFetchWithToken(token, path, options);
  return { token, data };
}

const DEFAULT_HUBSPOT_TIMEOUT_MS = 20_000;

// `hubspotFetch` above is a bare `fetch()` with no timeout at all — a
// stalled HubSpot API request leaves the awaiting call, and everything
// sequenced after it, stuck forever with no error and no recovery. See
// withTimeout's own comment for why a race (rather than a real abort) is
// the right tool here. Additive — existing `hubspotFetch`/
// `hubspotFetchIfConnected` call sites are unchanged; use this for new code
// paths that need a bounded worst case (e.g. a resumable, chunked pipeline
// with its own wall-clock time budget).
export async function hubspotFetchWithTimeout(
  path: string,
  options?: RequestInit,
  timeoutMs: number = DEFAULT_HUBSPOT_TIMEOUT_MS,
): Promise<unknown> {
  return withTimeout(hubspotFetch(path, options), timeoutMs, `HubSpot API call to "${path}"`);
}
