import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues, hubspotQueueItems } from "../server/db/schema.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";

export default defineAction({
  description: "Import a HubSpot contact list as an outreach queue.",
  schema: z.object({
    listId: z.string(),
    listName: z.string(),
    name: z.string().optional(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ listId, listName, name: queueName }, ctx) => {
    // Get member contact IDs from the list
    const memberships = (await hubspotFetch(
      `/crm/v3/lists/${listId}/memberships?limit=100`
    )) as { results?: Array<{ recordId: string }> };

    const contactIds = (memberships.results ?? []).map((m) => m.recordId);
    if (contactIds.length === 0) {
      return { queueId: "", totalCount: 0, error: "This list has no contacts." };
    }

    // Batch-read contact properties
    const batch = (await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
      method: "POST",
      body: JSON.stringify({
        inputs: contactIds.map((id) => ({ id })),
        properties: ["firstname", "lastname", "email", "company", "jobtitle", "hs_linkedin_url"],
      }),
    })) as { results?: Array<{ id: string; properties: Record<string, string> }> };

    const contacts = batch.results ?? [];
    const db = getDb();
    const queueId = nanoid();
    const now = new Date().toISOString();

    await db.insert(hubspotQueues).values({
      id: queueId,
      ownerEmail: ctx!.userEmail,
      name: queueName ?? listName,
      hubspotListId: listId,
      hubspotListName: listName,
      status: "active",
      totalCount: contacts.length,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const p = c.properties;
      await db.insert(hubspotQueueItems).values({
        id: nanoid(),
        queueId,
        hubspotContactId: c.id,
        firstName: p.firstname ?? null,
        lastName: p.lastname ?? null,
        email: p.email ?? null,
        company: p.company ?? null,
        jobTitle: p.jobtitle ?? null,
        linkedinUrl: p.hs_linkedin_url ?? null,
        status: "pending",
        position: i,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { queueId, totalCount: contacts.length };
  },
});
