import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";

export default defineAction({
  description:
    "Research a company and write a concise outreach-focused summary into the company node's notes field. Runs server-side so it completes regardless of tab state.",
  schema: z.object({
    nodeId: z.string().describe("The messaging node ID to write research into"),
    companyName: z.string().min(1).describe("The company name to research"),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ nodeId, companyName }) => {
    const systemPrompt =
      "You are a B2B sales researcher. Write a concise company research summary for use in LinkedIn outreach.\n\n" +
      "Cover: industry, estimated company size, business model, likely buyer pain points, recent news or initiatives, and GTM motion if inferrable.\n\n" +
      "Keep it under 180 words. Be factual and specific. No fluff, no filler sentences. Write in plain prose, not bullet points.";

    const input = `Research this company for outreach purposes: ${companyName}`;

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
