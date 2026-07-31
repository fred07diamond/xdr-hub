import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestOrgId } from "@agent-native/core/server";

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
