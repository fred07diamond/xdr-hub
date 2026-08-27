import { defineAction } from "@agent-native/core";
import { getHubSpotToken } from "@xdr-hub/shared/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

// Temporary diagnostic — not part of any product flow. Calls HubSpot's own
// token-introspection endpoint (GET /oauth/v1/access-tokens/{token}) to
// report which scopes the configured HUBSPOT_ACCESS_TOKEN actually has,
// without ever exposing the token value itself in the response. Delete once
// the automation/crm.lists.write scope question is settled.
export default defineAction({
  description: "Report which OAuth scopes the configured HubSpot token has, without exposing the token itself.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    // Everything below is caught and returned IN THE RESPONSE BODY rather
    // than thrown -- a thrown error here was showing up to the caller as a
    // bare "Internal server error" with no detail, so this makes whatever
    // actually fails self-diagnosing on the very next call instead of
    // requiring another round of guessing.
    try {
      try {
        await requireRole(ctx?.userEmail, ["admin"]);
      } catch (err) {
        return { stage: "requireRole", error: err instanceof Error ? err.message : String(err) };
      }

      let token: string | null;
      try {
        token = await getHubSpotToken();
      } catch (err) {
        return { stage: "getHubSpotToken", error: err instanceof Error ? err.message : String(err) };
      }
      if (!token) {
        return { connected: false, scopes: [], hasAutomation: false, hasListsWrite: false };
      }

      let res: Response;
      try {
        res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(token)}`);
      } catch (err) {
        return { stage: "fetch", error: err instanceof Error ? err.message : String(err) };
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { stage: "hubspot-response", status: res.status, error: body };
      }

      const data = (await res.json()) as { scopes?: string[]; hub_id?: number; user?: string };
      const scopes = data.scopes ?? [];
      return {
        connected: true,
        hubId: data.hub_id ?? null,
        scopes,
        hasAutomation: scopes.includes("automation"),
        hasListsWrite: scopes.includes("crm.lists.write"),
        hasListsRead: scopes.includes("crm.lists.read"),
      };
    } catch (err) {
      return { stage: "unexpected", error: err instanceof Error ? err.message : String(err) };
    }
  },
});
