import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { hubspotFetchIfConnected } from "@xdr-hub/shared/server";
import { assertNodeWritable } from "../server/helpers/canvas-access.js";

export default defineAction({
  description:
    "Research a company and write a concise outreach-focused summary into the company node's notes field. Runs server-side so it completes regardless of tab state.",
  schema: z.object({
    nodeId: z.string().describe("The messaging node ID to write research into"),
    companyName: z.string().min(1).describe("The company name to research"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ nodeId, companyName }, ctx) => {
    await assertNodeWritable(nodeId, ctx!.userEmail, getDb());
    const systemPrompt =
      "You are a B2B sales researcher. Write a concise company research summary for use in LinkedIn outreach.\n\n" +
      "Cover: industry, estimated company size, business model, likely buyer pain points, recent news or initiatives, and GTM motion if inferrable.\n\n" +
      "Keep it under 180 words. Be factual and specific. No fluff, no filler sentences. Write in plain prose, not bullet points.";

    // Best-effort: enrich with HubSpot company data when connected
    let crmContext = "";
    try {
      const hsResult = await hubspotFetchIfConnected("/crm/v3/objects/companies/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "name", operator: "EQ", value: companyName }] },
          ],
          properties: ["industry", "numberofemployees", "city", "hs_num_open_deals"],
          limit: 1,
        }),
      });
      if (hsResult) {
        const search = hsResult.data as { results?: Array<{ properties: Record<string, string> }> };
        const co = search.results?.[0]?.properties;
        if (co) {
          const parts = [
            co.industry && `Industry: ${co.industry}`,
            co.numberofemployees && `Employees: ~${co.numberofemployees}`,
            co.city && `HQ: ${co.city}`,
            co.hs_num_open_deals && Number(co.hs_num_open_deals) > 0
              ? `Open deals in CRM: ${co.hs_num_open_deals}`
              : null,
          ].filter(Boolean);
          if (parts.length) crmContext = `\n\nCRM context (HubSpot): ${parts.join(", ")}.`;
        }
      }
    } catch {
      // best-effort — continue without CRM data
    }

    const input = `Research this company for outreach purposes: ${companyName}${crmContext}`;

    const ownerCtx = await getOwnerCtx();
    const callCompleteText = () =>
      completeText({ systemPrompt, input, maxOutputTokens: 400 });

    const result = ownerCtx
      ? await runWithRequestContext(ownerCtx, callCompleteText)
      : await callCompleteText();

    const notes = result.text.trim();

    const db = getDb();
    await db
      .update(messagingNodes)
      .set({ notes, updatedAt: new Date().toISOString() })
      .where(eq(messagingNodes.id, nodeId));

    return { notes };
  },
});
