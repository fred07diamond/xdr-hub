import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { hubspotQueues, hubspotQueueItems } from "../server/db/schema.js";
import { hubspotFetch } from "@xdr-hub/shared/server";

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
    const IMPORT_LIMIT = 100;

    // Get member contact IDs from the list (capped at IMPORT_LIMIT)
    const memberships = (await hubspotFetch(
      `/crm/v3/lists/${listId}/memberships?limit=${IMPORT_LIMIT}`
    )) as { results?: Array<{ recordId: string }> };

    const contactIds = (memberships.results ?? []).map((m) => m.recordId);
    if (contactIds.length === 0) {
      return { queueId: "", totalCount: 0, error: "This list has no contacts." };
    }
    const truncated = contactIds.length >= IMPORT_LIMIT;

    // Batch-read contact properties in one call
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

    // Bulk insert all items in a single DB call
    if (contacts.length > 0) {
      await db.insert(hubspotQueueItems).values(
        contacts.map((c, i) => ({
          id: nanoid(),
          queueId,
          hubspotContactId: c.id,
          firstName: c.properties.firstname ?? null,
          lastName: c.properties.lastname ?? null,
          email: c.properties.email ?? null,
          company: c.properties.company ?? null,
          jobTitle: c.properties.jobtitle ?? null,
          linkedinUrl: c.properties.hs_linkedin_url ?? null,
          status: "pending" as const,
          position: i,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    return { queueId, totalCount: contacts.length, truncated };
  },
});
