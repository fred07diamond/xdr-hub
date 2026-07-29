import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingNodes } from "../server/db/schema.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description:
    "Fetch a HubSpot contact's name, role, and company by ID and write them into a hubspot_reference messaging node.",
  schema: z.object({
    nodeId: z.string().min(1),
    contactId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ nodeId, contactId }) => {
    const contact = (await hubspotFetch(
      `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,jobtitle,company`,
    )) as { properties?: Record<string, string> };
    const p = contact.properties ?? {};
    const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "Unknown";
    const role = p.jobtitle ?? null;
    const company = p.company ?? null;

    await getDb()
      .update(messagingNodes)
      .set({
        title: name,
        notes: role,
        exampleNotes: company,
        hubspotContactId: contactId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(messagingNodes.id, nodeId));

    return { name, role, company };
  },
});
