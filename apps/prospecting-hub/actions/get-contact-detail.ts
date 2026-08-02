import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, segmentContacts, segments, sourcingRules } from "../server/db/schema.js";
import {
  type CommonRoomContactEnrichment,
  lookupCommonRoomContactEnrichment,
} from "../server/helpers/commonroom-engagement.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Get a single contact's full detail row, its list (segment) memberships, and a best-effort live CommonRoom enrichment (recent activities, recently visited web pages, job history, and an AI-generated spark summary) — for the contact detail drawer's hover/click deep-dive view.",
  schema: z.object({ contactId: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ contactId }, ctx) => {
    // Same role gate as list-contacts.ts/get-segment.ts — contacts aren't
    // per-owner scoped in this app, so no extra ownership check is needed
    // beyond the standard xdr/ae/admin gate.
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

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
        source: contacts.source,
        personaId: contacts.personaId,
        country: contacts.country,
        employees: contacts.employees,
        draftEmailSubject: contacts.draftEmailSubject,
        draftEmailBody: contacts.draftEmailBody,
        draftLinkedinMessage: contacts.draftLinkedinMessage,
        draftGeneratedAt: contacts.draftGeneratedAt,
      })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    const contact = contactRows[0];
    if (!contact) {
      throw Object.assign(new Error(`Contact ${contactId} not found.`), { statusCode: 404 });
    }

    // Segment membership — mirrors list-segments.ts's own sourcingRules join
    // to report isActive (Active list vs. Static list) alongside id/name.
    const segmentRows = await db
      .select({ id: segments.id, name: segments.name, sourcingRuleId: sourcingRules.id })
      .from(segmentContacts)
      .innerJoin(segments, eq(segmentContacts.segmentId, segments.id))
      .leftJoin(sourcingRules, eq(sourcingRules.segmentId, segments.id))
      .where(eq(segmentContacts.contactId, contactId));

    const contactSegments = segmentRows.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.sourcingRuleId != null,
    }));

    // Best-effort live CommonRoom enrichment — a CommonRoom hiccup (no
    // org-scoped connection configured, MCP timeout/failure, or no fuzzy
    // identity match found) must never fail this action; the contact's own
    // DB row above is always the primary payload and always returns
    // regardless of CommonRoom's availability. Mirrors score-contact.ts's own
    // "CommonRoom hiccup -> null, never fail the whole operation" precedent.
    let commonRoomEnrichment: CommonRoomContactEnrichment | null = null;
    try {
      commonRoomEnrichment = await lookupCommonRoomContactEnrichment({
        orgId: ctx?.orgId,
        fullName: contact.name,
        companyName: contact.company,
      });
    } catch {
      commonRoomEnrichment = null;
    }

    return {
      contact,
      segments: contactSegments,
      commonRoomEnrichment,
    };
  },
});
