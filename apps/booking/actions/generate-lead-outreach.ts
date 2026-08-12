import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { inboundLeads } from "../server/db/schema.js";
import { generateLeadOutreach, type LeadContext } from "../server/helpers/generate-lead-outreach.js";
import { getOwnerName } from "../server/helpers/ae-name.js";
import { hubspotFetch } from "../server/helpers/hubspot-client.js";
import { requireRole } from "../server/helpers/require-role.js";

interface HubSpotContact {
  properties?: {
    jobtitle?: string;
    lifecyclestage?: string;
    what_is_your_use_case__contact_sales_?: string;
    message?: string;
  };
}

interface HubSpotCompany {
  properties?: {
    name?: string;
    domain?: string;
    industry?: string;
    numberofemployees?: string;
    hubspot_owner_id?: string;
  };
}

async function fetchLeadContext(hubspotContactId: string): Promise<Omit<LeadContext, "prospectName" | "prospectEmail" | "company" | "contactSalesDate">> {
  const empty = {
    jobTitle: null,
    companyDomain: null,
    companyIndustry: null,
    companySize: null,
    lifecycleStage: null,
    useCaseMessage: null,
    aeName: null,
    aeEmail: null,
    existingDeals: null,
  };

  let jobTitle: string | null = null;
  let lifecycleStage: string | null = null;
  let useCaseMessage: string | null = null;

  try {
    const contact = (await hubspotFetch(
      `/crm/v3/objects/contacts/${hubspotContactId}?properties=jobtitle,lifecyclestage,what_is_your_use_case__contact_sales_,message`,
    )) as HubSpotContact;
    jobTitle = contact.properties?.jobtitle ?? null;
    lifecycleStage = contact.properties?.lifecyclestage ?? null;
    useCaseMessage =
      contact.properties?.what_is_your_use_case__contact_sales_ ?? contact.properties?.message ?? null;
  } catch {
    // Best-effort -- proceed with whatever we have.
  }

  let companyDomain: string | null = null;
  let companyIndustry: string | null = null;
  let companySize: string | null = null;
  let aeEmail: string | null = null;
  let companyId: string | null = null;

  try {
    const assoc = (await hubspotFetch(
      `/crm/v4/objects/contacts/${hubspotContactId}/associations/companies`,
    )) as { results?: Array<{ toObjectId: string }> };
    companyId = assoc.results?.[0]?.toObjectId ?? null;

    if (companyId) {
      const companyObj = (await hubspotFetch(
        `/crm/v3/objects/companies/${companyId}?properties=name,domain,industry,numberofemployees,hubspot_owner_id`,
      )) as HubSpotCompany;
      companyDomain = companyObj.properties?.domain ?? null;
      companyIndustry = companyObj.properties?.industry ?? null;
      companySize = companyObj.properties?.numberofemployees ?? null;
      const ownerId = companyObj.properties?.hubspot_owner_id;
      if (ownerId) {
        const owner = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as { email?: string };
        aeEmail = owner.email ?? null;
      }
    }
  } catch {
    // Best-effort -- company/AE enrichment is nice to have, not required.
  }

  let aeName: string | null = null;
  if (aeEmail) {
    const resolved = await getOwnerName(aeEmail);
    aeName = resolved?.fullName ?? null;
  }

  let existingDeals: string | null = null;
  if (companyId) {
    try {
      const dealAssoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${companyId}/associations/deals`,
      )) as { results?: Array<{ toObjectId: string }> };
      const dealIds = (dealAssoc.results ?? []).slice(0, 5).map((d) => d.toObjectId);
      if (dealIds.length > 0) {
        const deals = await Promise.all(
          dealIds.map((id) =>
            hubspotFetch(`/crm/v3/objects/deals/${id}?properties=dealname,dealstage,amount`).catch(
              () => null,
            ),
          ),
        );
        const summaries = deals
          .filter((d): d is { properties?: Record<string, string> } => !!d)
          .map((d) => {
            const p = d.properties ?? {};
            return `${p.dealname ?? "(unnamed)"} - stage ${p.dealstage ?? "?"}${p.amount ? ` - $${p.amount}` : ""}`;
          });
        existingDeals = summaries.length > 0 ? summaries.join("; ") : null;
      }
    } catch {
      // Best-effort.
    }
  }

  return { ...empty, jobTitle, lifecycleStage, useCaseMessage, companyDomain, companyIndustry, companySize, aeName, aeEmail, existingDeals };
}

export default defineAction({
  description:
    "Generate qualification notes, CRM note, and a first-touch outreach email for one inbound Contact Sales lead.",
  schema: z.object({
    leadId: z.string().min(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ leadId }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "admin"]);

    const db = getDb();
    const [lead] = await db.select().from(inboundLeads).where(eq(inboundLeads.id, leadId)).limit(1);
    if (!lead) {
      throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
    }

    const enrichment = await fetchLeadContext(lead.hubspotContactId);

    const outreach = await generateLeadOutreach({
      prospectName: lead.prospectName,
      prospectEmail: lead.prospectEmail,
      company: lead.company,
      contactSalesDate: lead.contactSalesDate,
      ...enrichment,
    });

    const now = new Date().toISOString();
    await db
      .update(inboundLeads)
      .set({
        qualificationTier: outreach.qualificationTier,
        meetingAgenda: outreach.meetingAgenda,
        xdrPain: outreach.xdrPain,
        xdrContactQualification: outreach.xdrContactQualification,
        xdrNotes: outreach.xdrNotes,
        crmNote: outreach.crmNote,
        outreachEmail: outreach.outreachEmail,
        emailSubject: outreach.emailSubject,
        outreachGeneratedAt: now,
      })
      .where(eq(inboundLeads.id, leadId));

    return { leadId, ...outreach };
  },
});
