import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { workspaceSettings } from "../db/schema.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";

export async function getHubSpotToken(): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, "hubspot_access_token"));
  return rows[0]?.value ?? null;
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
  const token = await getHubSpotToken();
  if (!token) {
    throw new Error("HubSpot not connected. Add your API key in Settings.");
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
