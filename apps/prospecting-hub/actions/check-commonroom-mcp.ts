import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";
import { searchProspectorContacts } from "../server/helpers/prospector-client.js";

// Temporary diagnostic — isolates the CommonRoom MCP call path from
// everything else in run-sourcing-rule-pipeline.ts (persona lookups, DB
// writes, scoring) to answer one question directly: does a live CommonRoom
// Prospector search succeed or fail, and with exactly what error, right now.
// Delete once the "MCP client is not configured" issue is resolved.
export default defineAction({
  description: "Directly test a minimal CommonRoom Prospector search, isolated from the rest of the sourcing-rule pipeline.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    try {
      await requireRole(ctx?.userEmail, ["admin"]);
    } catch (err) {
      return { stage: "requireRole", error: err instanceof Error ? err.message : String(err) };
    }

    try {
      const result = await searchProspectorContacts({
        orgId: ctx?.orgId,
        titleKeywords: ["VP"],
        limit: 2,
      });
      return {
        ok: true,
        orgId: ctx?.orgId ?? null,
        recordCount: result.records.length,
        sample: result.records[0]?.fullName ?? null,
      };
    } catch (err) {
      return {
        ok: false,
        orgId: ctx?.orgId ?? null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
