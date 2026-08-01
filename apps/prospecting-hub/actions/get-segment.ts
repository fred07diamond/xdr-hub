import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, sourcingRules } from "../server/db/schema.js";
import { assertSegmentReadable } from "../server/helpers/segment-access.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Get a segment and its full contact list, if the caller can read it.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();
    const segment = await assertSegmentReadable(id, ctx!.userEmail!, db);

    // A sourcing-rule-owned segment has `filters: null` by design (it's
    // populated by the rule's pipeline run, not the generic persona/score
    // query refresh-segment.ts uses) — the UI needs to know this so it can
    // offer "run the sourcing rule" instead of a generic refresh that will
    // always fail with "no generation filters" for this kind of segment.
    const owningRuleRows = await db
      .select({ id: sourcingRules.id, name: sourcingRules.name })
      .from(sourcingRules)
      .where(eq(sourcingRules.segmentId, id))
      .limit(1);
    const owningSourcingRule = owningRuleRows[0] ?? null;

    const contactRows = await db
      .select({
        id: contacts.id,
        name: contacts.name,
        title: contacts.title,
        company: contacts.company,
        email: contacts.email,
        personaMatchScore: contacts.personaMatchScore,
        companyFitScore: contacts.companyFitScore,
        engagementScore: contacts.engagementScore,
        hubspotQlScore: contacts.hubspotQlScore,
        commonRoomIntentScore: contacts.commonRoomIntentScore,
        commonRoomCompanyFitScore: contacts.commonRoomCompanyFitScore,
        overallScore: contacts.overallScore,
        scoreReasoning: contacts.scoreReasoning,
        status: contacts.status,
        linkedinUrl: contacts.linkedinUrl,
        hubspotUrl: contacts.hubspotUrl,
      })
      .from(segmentContacts)
      .innerJoin(contacts, eq(segmentContacts.contactId, contacts.id))
      .where(eq(segmentContacts.segmentId, id));

    return {
      segment: {
        ...segment,
        owningSourcingRuleId: owningSourcingRule?.id ?? null,
        owningSourcingRuleName: owningSourcingRule?.name ?? null,
      },
      contacts: contactRows,
    };
  },
});
