const HUBSPOT_API_BASE = "https://api.hubapi.com";

export function getHubSpotToken(): string | null {
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
    throw new Error(`HubSpot API error (${res.status}): ${body}`);
  }
  return res.json();
}

export async function hubspotFetch(path: string, options?: RequestInit): Promise<unknown> {
  const token = getHubSpotToken();
  if (!token) {
    throw new Error("HubSpot not connected. Set HUBSPOT_ACCESS_TOKEN in your environment.");
  }
  return hubspotFetchWithToken(token, path, options);
}

export async function hubspotFetchIfConnected(
  path: string,
  options?: RequestInit,
): Promise<{ token: string; data: unknown } | null> {
  const token = getHubSpotToken();
  if (!token) return null;
  const data = await hubspotFetchWithToken(token, path, options);
  return { token, data };
}
