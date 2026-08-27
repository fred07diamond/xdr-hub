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
    await requireRole(ctx?.userEmail, ["admin"]);

    const token = await getHubSpotToken();
    if (!token) {
      return { connected: false, scopes: [], hasAutomation: false, hasListsWrite: false };
    }

    const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw Object.assign(new Error(`HubSpot token introspection failed (${res.status}): ${body}`), {
        statusCode: 502,
      });
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
  },
});
