import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description: "Check whether HubSpot is connected by verifying the stored token.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const token = await getHubSpotToken();
    if (!token) return { connected: false };
    try {
      await hubspotFetch("/crm/v3/owners?limit=1");
      return { connected: true };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  },
});
