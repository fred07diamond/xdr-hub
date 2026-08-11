import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { z } from "zod";
import { requireRole } from "../server/helpers/require-role.js";

const NOOKS_API_BASE = "https://partner-api.nooks.in/v1";

// Temporary diagnostic — not for product use. Answers one question: does the
// connected user's OAuth token (scopes calls:read, call-dispositions:read,
// coaching:read, teams:read) expose transcript TEXT anywhere — a documented
// field, an undocumented /transcript sub-resource, or an undocumented
// coaching/teams endpoint — or only transcriptUrl (a link into the Nooks web
// app)? Admin-only. Delete once answered.
export default defineAction({
  description: "[diagnostic] Probe Nooks endpoints (including undocumented ones) for transcript access.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  agentTool: false,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    await requireRole(ctx?.userEmail, ["admin"]);

    const accounts = await getOAuthAccounts("nooks", ctx!.userEmail);
    const token = accounts[0]?.tokens?.access_token as string | undefined;
    if (!token) throw new Error("Nooks not connected for this user.");
    const headers = { Authorization: `Bearer ${token}` };

    async function probe(label: string, path: string) {
      const res = await fetch(`${NOOKS_API_BASE}${path}`, { headers });
      const body = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // leave null, report raw below
      }
      return {
        label,
        path,
        status: res.status,
        fieldNames:
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? Object.keys(parsed as Record<string, unknown>)
            : null,
        body: body.slice(0, 1500),
      };
    }

    const listRes = await fetch(`${NOOKS_API_BASE}/calls?page[size]=3&filter[hasTranscript]=true`, {
      headers,
    }).catch(() => null);
    const listBody = listRes ? await listRes.text() : "";
    let firstCallId: string | undefined;
    if (listRes?.ok) {
      try {
        const list = JSON.parse(listBody) as { data?: Array<{ id: string }> };
        firstCallId = list.data?.[0]?.id;
      } catch {
        // ignore
      }
    }

    const results = await Promise.all([
      probe("list-calls (hasTranscript filter)", "/calls?page[size]=3&filter[hasTranscript]=true"),
      firstCallId
        ? probe("call-detail", `/calls/${firstCallId}`)
        : Promise.resolve({ label: "call-detail", path: null, status: null, note: "no call id from list" }),
      firstCallId
        ? probe("call-detail with include=transcript", `/calls/${firstCallId}?include=transcript`)
        : Promise.resolve({ label: "call-detail with include=transcript", path: null, status: null }),
      firstCallId
        ? probe("transcript sub-resource", `/calls/${firstCallId}/transcript`)
        : Promise.resolve({ label: "transcript sub-resource", path: null, status: null }),
      probe("teams", "/teams"),
      probe("coaching", "/coaching"),
      firstCallId ? probe("coaching for call", `/coaching/calls/${firstCallId}`) : Promise.resolve({ label: "coaching for call", path: null, status: null }),
      probe("desktop-notes", "/desktopNotes"),
    ]);

    return { firstCallId, results };
  },
});
