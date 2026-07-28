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

export async function hubspotFetch(path: string, options?: RequestInit): Promise<unknown> {
  const token = await getHubSpotToken();
  if (!token) {
    throw new Error("HubSpot not connected. Set HUBSPOT_ACCESS_TOKEN in your .env file.");
  }
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
    try { message = (JSON.parse(body) as { message?: string }).message ?? body; } catch { /* use raw body */ }
    if (res.status === 401) throw new Error("Invalid HubSpot token — use a Private App token starting with pat-");
    throw new Error(`HubSpot error (${res.status}): ${message}`);
  }
  return res.json();
}
