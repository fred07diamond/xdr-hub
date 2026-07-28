import { defineAction } from "@agent-native/core";
import { getOAuthAccounts } from "@agent-native/core/server";
import { z } from "zod";

const NOOKS_API_BASE = "https://partner-api.nooks.in/v1";

// Temporary diagnostic — not for product use. Answers one question: does the
// connected user's OAuth token expose transcript TEXT anywhere on a recent
// call, or only transcriptUrl (a link into the Nooks web app)? Delete once
// answered.
export default defineAction({
  description: "[diagnostic] Inspect a recent Nooks call's fields for transcript access.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const accounts = await getOAuthAccounts("nooks", ctx!.userEmail);
    const token = accounts[0]?.tokens?.access_token as string | undefined;
    if (!token) throw new Error("Nooks not connected for this user.");

    const listRes = await fetch(`${NOOKS_API_BASE}/calls?page[size]=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.text();
    if (!listRes.ok) {
      return { step: "list-calls", status: listRes.status, body: listBody.slice(0, 1000) };
    }
    const list = JSON.parse(listBody) as { data?: Array<{ id: string }> };
    const first = list.data?.[0];
    if (!first) return { step: "list-calls", status: 200, note: "no calls returned", raw: list };

    const detailRes = await fetch(`${NOOKS_API_BASE}/calls/${first.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detailBody = await detailRes.text();
    return {
      step: "call-detail",
      status: detailRes.status,
      callId: first.id,
      fieldNames: detailRes.ok ? Object.keys(JSON.parse(detailBody)) : null,
      body: detailBody.slice(0, 2000),
    };
  },
});
