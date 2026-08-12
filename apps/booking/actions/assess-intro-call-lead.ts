import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { fetchIntroCallResearch, resolveIntroCallContactId } from "../server/helpers/intro-call-hubspot.js";
import { scoreIntroCallLead } from "../server/helpers/intro-call-score.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Pull full HubSpot research for one Contact Sales lead (contact, company, other contacts, deals) and run it through the deterministic Intro Call scoring engine (product id, enterprise-need signals, seat math, maturity stage, Closed Lost override, agency signal, recommendation). Takes a HubSpot contact URL/id, or a name (+ optional company) to search by.",
  schema: z.object({
    hubspotUrlOrId: z.string().optional().describe("A pasted HubSpot contact URL, or a raw contact id"),
    name: z.string().optional().describe("Contact name, used to search HubSpot if no URL/id is given"),
    company: z.string().optional().describe("Company name, used to disambiguate a name search"),
  }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "POST" },
  run: async ({ hubspotUrlOrId, name, company }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const resolved = await resolveIntroCallContactId({ hubspotUrlOrId, name, company });
    if ("error" in resolved) {
      throw Object.assign(new Error(resolved.error), { statusCode: 400 });
    }

    const research = await fetchIntroCallResearch(resolved.contactId);
    const scorecard = scoreIntroCallLead(research);

    return { research, scorecard };
  },
});
