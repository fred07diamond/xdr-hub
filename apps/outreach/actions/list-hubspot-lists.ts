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
    const data = (await hubspotFetch(
      "/crm/v3/lists?objectTypeId=0-1&limit=100&includeFilters=false"
    )) as { lists?: Array<{ listId: string; name: string; size: number }> };
    const lists = (data.lists ?? []).map((l) => ({
      id: l.listId,
      name: l.name,
      size: l.size,
    }));
    return { lists };
  },
});
