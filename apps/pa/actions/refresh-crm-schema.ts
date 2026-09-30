import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { refreshHubSpotSchema } from "../server/lib/crm-schema.js";
import { now } from "../server/lib/pa-context.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "Read the CRM's property definitions (contacts, companies, deals) from HubSpot and store them for mapping. Read-only: names, types, and picklist options, never records. For the app owner and RevOps.",
  schema: z.object({}),
  audit: {
    target: () => ({
      type: "pa-crm-schema",
      id: "hubspot",
      visibility: "org" as const,
    }),
    summary: () => "Refreshed the HubSpot field definitions",
  },
  run: async (_args, ctx) => {
    const actor = actorOf(ctx);
    const directory = teamDirectory(ctx);
    const [owner, team] = await Promise.all([
      directory.isAppOwner(actor.email),
      directory.teamOf(actor.email),
    ]);
    if (!owner && team !== "revops")
      fail("The app owner or RevOps refreshes CRM fields", { statusCode: 403 });
    try {
      const portal = await refreshHubSpotSchema(actor.email, now());
      return {
        fetchedAt: portal.fetchedAt,
        counts: Object.fromEntries(
          Object.entries(portal.objects).map(([object, properties]) => [
            object,
            properties?.length ?? 0,
          ]),
        ),
      };
    } catch (error) {
      fail(
        `Could not read HubSpot fields: ${error instanceof Error ? error.message : String(error)}. Check the token on the CRM connections page.`,
        {
          statusCode: 502,
        },
      );
    }
  },
});
