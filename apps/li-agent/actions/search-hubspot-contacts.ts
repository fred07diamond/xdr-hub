import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";

interface HubspotContactResult {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    jobtitle?: string;
    company?: string;
    email?: string;
  };
}

export default defineAction({
  description:
    "Search HubSpot contacts by name or company for the HubSpot Reference messaging-canvas node.",
  schema: z.object({
    query: z.string().min(1).max(100),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ query }) => {
    const term = query.trim();

    // OR across name/company: separate filterGroups mean "any group matches".
    const searchBody = {
      filterGroups: [
        { filters: [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: term }] },
        { filters: [{ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: term }] },
        { filters: [{ propertyName: "company", operator: "CONTAINS_TOKEN", value: term }] },
      ],
      properties: ["firstname", "lastname", "jobtitle", "company", "email"],
      limit: 10,
    };

    const result = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    })) as { results?: HubspotContactResult[] };

    const contacts = (result.results ?? []).map((c) => {
      const p = c.properties;
      const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || "Unknown";
      return {
        id: c.id,
        name,
        title: p.jobtitle ?? null,
        company: p.company ?? null,
        email: p.email ?? null,
      };
    });

    return { contacts };
  },
});
