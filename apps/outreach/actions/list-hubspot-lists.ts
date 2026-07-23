import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description: "List available HubSpot contact lists for queue creation.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const token = getHubSpotToken();
    if (!token) return { lists: [], error: "HubSpot not connected" };
    let data: Record<string, unknown>;
    try {
      data = (await hubspotFetch(
        "/crm/v3/lists?objectTypeId=0-1&limit=100&includeFilters=false"
      )) as Record<string, unknown>;
    } catch (err) {
      return { lists: [], error: err instanceof Error ? err.message : String(err) };
    }

    // HubSpot returns `lists` for this endpoint; `results` is used by other CRM endpoints
    const rawLists = (data.lists ?? data.results ?? []) as Array<{
      listId?: string | number;
      id?: string | number;
      name: string;
      size?: number;
      membershipCount?: number;
    }>;

    if (rawLists.length === 0) {
      const keys = Object.keys(data).join(", ");
      const count = (data.count as number | undefined) ?? (data.total as number | undefined);
      if (count !== undefined && count > 0) {
        return { lists: [], error: `HubSpot returned ${count} lists but none were readable — your Private App token may be missing the crm.lists.read scope` };
      }
      return { lists: [], debug: `Response keys: ${keys}` };
    }

    const lists = rawLists.map((l) => ({
      id: String(l.listId ?? l.id ?? ""),
      name: l.name,
      size: l.size ?? l.membershipCount ?? 0,
    }));
    return { lists };
  },
});
