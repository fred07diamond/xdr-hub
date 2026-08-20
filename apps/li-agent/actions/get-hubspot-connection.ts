import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getHubSpotToken, hubspotFetch } from "@xdr-hub/shared/server";

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
      // Best-effort portal identity so the Settings card can show WHICH
      // HubSpot account is connected, not just a bare "Connected" -- the
      // owners lookup above only proves the token works, it doesn't say
      // which portal it belongs to.
      let portalId: string | null = null;
      try {
        const accountInfo = (await hubspotFetch("/account-info/v3/details")) as { portalId?: number };
        portalId = accountInfo.portalId != null ? String(accountInfo.portalId) : null;
      } catch {
        // Non-fatal -- the token can still be valid even if this scope isn't granted.
      }
      return { connected: true, portalId };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  },
});
