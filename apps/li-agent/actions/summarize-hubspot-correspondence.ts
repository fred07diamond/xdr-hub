import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";

interface EmailResult {
  properties: {
    hs_email_subject?: string;
    hs_email_text?: string;
    hs_timestamp?: string;
    hs_email_direction?: string;
  };
}

export default defineAction({
  description:
    "Pull a HubSpot contact's info and email correspondence, summarize what worked, and write it into a hubspot_reference messaging node.",
  schema: z.object({
    nodeId: z.string().min(1),
    contactId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ nodeId, contactId }) => {
    const contact = (await hubspotFetch(
      `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,jobtitle,company,email`,
    )) as { properties?: Record<string, string> };
    const p = contact.properties ?? {};
    const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "Unknown";
    const notes = [p.jobtitle, p.company].filter(Boolean).join(" at ") || null;

    // Best-effort: associated email engagements. Requires the Private App
    // token to have CRM email-read scope — if it doesn't, this throws a
    // clear "HubSpot error (403): ..." that surfaces to the user as-is so
    // the fix (add the scope in HubSpot admin settings) is obvious.
    let emails: EmailResult[] = [];
    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/contacts/${contactId}/associations/emails`,
      )) as { results?: Array<{ toObjectId: string }> };
      const emailIds = (assoc.results ?? []).map((r) => r.toObjectId).slice(0, 10);
      if (emailIds.length > 0) {
        const batch = (await hubspotFetch("/crm/v3/objects/emails/batch/read", {
          method: "POST",
          body: JSON.stringify({
            properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
            inputs: emailIds.map((id) => ({ id })),
          }),
        })) as { results?: EmailResult[] };
        emails = batch.results ?? [];
      }
    } catch {
      // No email-read scope, or no associations endpoint access — proceed
      // without correspondence rather than failing the whole node.
    }

    if (emails.length === 0) {
      await getDb()
        .update(messagingNodes)
        .set({ title: name, notes, hubspotContactId: contactId, updatedAt: new Date().toISOString() })
        .where(eq(messagingNodes.id, nodeId));
      return {
        name,
        notes,
        exampleNotes: null,
        warning: "No email history found for this contact.",
      };
    }

    const transcript = emails
      .sort((a, b) => (a.properties.hs_timestamp ?? "").localeCompare(b.properties.hs_timestamp ?? ""))
      .map((e) => {
        const dir = e.properties.hs_email_direction ?? "";
        const subject = e.properties.hs_email_subject ?? "";
        const body = (e.properties.hs_email_text ?? "").slice(0, 800);
        return `[${dir}] ${subject}\n${body}`;
      })
      .join("\n\n---\n\n");

    const systemPrompt =
      "You summarize real sales email correspondence into a short reference note " +
      "another rep can use to personalize outreach to a similar prospect.\n\n" +
      "Ground the summary ONLY in the emails provided — never invent details, " +
      "outcomes, or sentiment that isn't in the text. If the correspondence " +
      "doesn't show a clear outcome, say so plainly instead of guessing.\n\n" +
      "Write 2-4 sentences: what the prospect cared about, what angle/approach " +
      "worked, and any concrete detail worth reusing. Plain prose, no bullets.";

    const ownerCtx = await getOwnerCtx();
    const callCompleteText = () =>
      completeText({
        systemPrompt,
        input: `Email correspondence with ${name}${notes ? ` (${notes})` : ""}:\n\n${transcript}`,
        maxOutputTokens: 300,
      });
    const result = ownerCtx
      ? await runWithRequestContext(ownerCtx, callCompleteText)
      : await callCompleteText();

    const exampleNotes = result.text.trim();

    await getDb()
      .update(messagingNodes)
      .set({ title: name, notes, exampleNotes, hubspotContactId: contactId, updatedAt: new Date().toISOString() })
      .where(eq(messagingNodes.id, nodeId));

    return { name, notes, exampleNotes };
  },
});
