import { hubspotFetch } from "./hubspot-client.js";
import { getOwnerName } from "./ae-name.js";

// Verified live against this HubSpot portal -- see the two corrections below.
// Do not rename these without re-verifying against the portal's actual
// property definitions (search_properties / get_properties), not the master
// instructions doc's prose, which turned out to be wrong on both points:
//
// 1. "First Space Kind" (space_kind) exists on CONTACTS only. There is no
//    matching field on the COMPANY record -- the closest company-level field
//    (space_type) is a different axis entirely (CMS vs Shopify, not
//    Content vs Code). So product identification checks the contact only.
// 2. The two Closed Lost fields are named the opposite of what the doc's
//    prose implies: the categorical dropdown ("Went Self Serve", etc.) is
//    `closed_lost_reason_dropdown`; the field literally named
//    `closed_lost_reason` is free-text detail, not the category. Override
//    matching uses the dropdown's real enum.

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "jobtitle",
  "city",
  "state",
  "country",
  "hs_linkedin_url",
  "hs_analytics_source",
  "notes_last_updated",
  "first_conversion_event_name",
  "recent_conversion_event_name",
  "company_fit_score___breeze",
  "sign_up_time_stamp",
  "space_kind",
  "jobfunctions",
  "how_you_heard_about_builder",
  "num_notes",
  "message",
  "what_is_your_use_case__contact_sales_",
  "hubspot_owner_id",
].join(",");

const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "industry",
  "numberofemployees",
  "city",
  "state",
  "country",
  "hs_parent_company_id",
  "hubspot_owner_id",
].join(",");

const OTHER_CONTACT_PROPERTIES = ["firstname", "lastname", "jobtitle", "notes_last_updated", "last_active_in_builder"].join(
  ",",
);

const DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "hubspot_owner_id",
  "hs_lastmodifieddate",
  "closedate",
  "closed_lost_reason_dropdown",
  "closed_lost_reason",
].join(",");

const OTHER_CONTACTS_CAP = 20;
const DEALS_CAP = 10;

export interface IntroCallContact {
  id: string;
  name: string | null;
  jobTitle: string | null;
  location: string | null;
  linkedinUrl: string | null;
  source: string | null;
  lastActivityDate: string | null;
  firstConversion: string | null;
  recentConversion: string | null;
  breezeFitScore: string | null;
  signUpTimeStamp: string | null;
  firstSpaceKind: string | null;
  jobFunctions: string | null;
  howHeardAboutBuilder: string | null;
  numNotes: number;
  messageVerbatim: string | null;
  ownerId: string | null;
}

export interface IntroCallOtherContact {
  id: string;
  name: string | null;
  jobTitle: string | null;
  lastActivityDate: string | null;
  activeInBuilderApp: boolean;
}

export interface IntroCallDeal {
  id: string;
  name: string | null;
  stage: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  lastActivityDate: string | null;
  closeDate: string | null;
  closedLostReasonCategory: string | null;
  closedLostReasonDetail: string | null;
}

export interface IntroCallCompany {
  id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  location: string | null;
  parentCompanyName: string | null;
}

export interface IntroCallResearch {
  contact: IntroCallContact;
  company: IntroCallCompany | null;
  otherContacts: IntroCallOtherContact[];
  activeInAppUserCount: number;
  deals: IntroCallDeal[];
  notesUnreadable: boolean;
}

interface HubSpotObjectResult {
  id: string;
  properties: Record<string, string | undefined>;
}

function joinLocation(city?: string, state?: string, country?: string): string | null {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// Resolve a HubSpot contact id from a pasted contact URL, a raw numeric id,
// or a name (+ optional company) fallback search. Mirrors the URL shapes
// HubSpot actually issues: .../contacts/{portalId}/contact/{id},
// .../contacts/{portalId}/record/0-1/{id}.
export async function resolveIntroCallContactId(input: {
  hubspotUrlOrId?: string;
  name?: string;
  company?: string;
}): Promise<{ contactId: string } | { error: string }> {
  const raw = input.hubspotUrlOrId?.trim();
  if (raw) {
    const idMatch = raw.match(/\/(?:contact|record\/0-1)\/(\d+)/) ?? raw.match(/^(\d+)$/);
    if (idMatch) return { contactId: idMatch[1] };
    if (!input.name) {
      return { error: `Couldn't find a contact id in "${raw}". Pass the HubSpot contact URL, a raw contact id, or a name.` };
    }
  }

  if (input.name) {
    const parts = input.name.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ");
    const nameFilters: object[] = [{ propertyName: "firstname", operator: "CONTAINS_TOKEN", value: firstName }];
    if (lastName) nameFilters.push({ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: lastName });

    const result = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: nameFilters }],
        properties: ["firstname", "lastname", "company"],
        limit: 5,
      }),
    })) as { results?: HubSpotObjectResult[] };

    if (!result.results?.length) {
      return { error: `No HubSpot contact found matching "${input.name}".` };
    }

    let match = result.results[0];
    if (input.company && result.results.length > 1) {
      const companyLower = input.company.toLowerCase();
      const found = result.results.find((c) => c.properties.company?.toLowerCase().includes(companyLower));
      if (found) match = found;
    }
    return { contactId: match.id };
  }

  return { error: "Need a HubSpot contact URL/id or a name to look up." };
}

export async function fetchIntroCallResearch(contactId: string): Promise<IntroCallResearch> {
  const contactObj = (await hubspotFetch(
    `/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_PROPERTIES}`,
  )) as HubSpotObjectResult;
  const cp = contactObj.properties;

  const contact: IntroCallContact = {
    id: contactObj.id,
    name: [cp.firstname, cp.lastname].filter(Boolean).join(" ") || null,
    jobTitle: cp.jobtitle ?? null,
    location: joinLocation(cp.city, cp.state, cp.country),
    linkedinUrl: cp.hs_linkedin_url ?? null,
    source: cp.hs_analytics_source ?? null,
    lastActivityDate: cp.notes_last_updated ?? null,
    firstConversion: cp.first_conversion_event_name ?? null,
    recentConversion: cp.recent_conversion_event_name ?? null,
    breezeFitScore: cp.company_fit_score___breeze ?? null,
    signUpTimeStamp: cp.sign_up_time_stamp ?? null,
    firstSpaceKind: cp.space_kind ?? null,
    jobFunctions: cp.jobfunctions ?? null,
    howHeardAboutBuilder: cp.how_you_heard_about_builder ?? null,
    numNotes: Number(cp.num_notes ?? 0) || 0,
    messageVerbatim: cp.what_is_your_use_case__contact_sales_ ?? cp.message ?? null,
    ownerId: cp.hubspot_owner_id ?? null,
  };

  let company: IntroCallCompany | null = null;
  let otherContacts: IntroCallOtherContact[] = [];
  let deals: IntroCallDeal[] = [];
  let companyId: string | null = null;

  try {
    const assoc = (await hubspotFetch(`/crm/v4/objects/contacts/${contactId}/associations/companies`)) as {
      results?: Array<{ toObjectId: string }>;
    };
    companyId = assoc.results?.[0]?.toObjectId ?? null;
  } catch {
    // Best-effort.
  }

  if (companyId) {
    try {
      const companyObj = (await hubspotFetch(
        `/crm/v3/objects/companies/${companyId}?properties=${COMPANY_PROPERTIES}`,
      )) as HubSpotObjectResult;
      const co = companyObj.properties;

      let parentCompanyName: string | null = null;
      if (co.hs_parent_company_id) {
        try {
          const parent = (await hubspotFetch(
            `/crm/v3/objects/companies/${co.hs_parent_company_id}?properties=name`,
          )) as HubSpotObjectResult;
          parentCompanyName = parent.properties.name ?? null;
        } catch {
          // Best-effort.
        }
      }

      company = {
        id: companyObj.id,
        name: co.name ?? null,
        domain: co.domain ?? null,
        industry: co.industry ?? null,
        employeeCount: co.numberofemployees ? Number(co.numberofemployees) || null : null,
        location: joinLocation(co.city, co.state, co.country),
        parentCompanyName,
      };
    } catch {
      // Best-effort.
    }

    try {
      const contactAssoc = (await hubspotFetch(
        `/crm/v4/objects/companies/${companyId}/associations/contacts`,
      )) as { results?: Array<{ toObjectId: string }> };
      const otherIds = (contactAssoc.results ?? [])
        .map((r) => r.toObjectId)
        .filter((id) => id !== contactId)
        .slice(0, OTHER_CONTACTS_CAP);

      const fetched = await Promise.all(
        otherIds.map((id) =>
          hubspotFetch(`/crm/v3/objects/contacts/${id}?properties=${OTHER_CONTACT_PROPERTIES}`).catch(() => null),
        ),
      );
      otherContacts = fetched
        .filter((c): c is HubSpotObjectResult => !!c)
        .map((c) => ({
          id: c.id,
          name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(" ") || null,
          jobTitle: c.properties.jobtitle ?? null,
          lastActivityDate: c.properties.notes_last_updated ?? null,
          activeInBuilderApp: !!c.properties.last_active_in_builder,
        }));
    } catch {
      // Best-effort.
    }

    try {
      const dealAssoc = (await hubspotFetch(`/crm/v4/objects/companies/${companyId}/associations/deals`)) as {
        results?: Array<{ toObjectId: string }>;
      };
      const dealIds = (dealAssoc.results ?? []).slice(0, DEALS_CAP).map((d) => d.toObjectId);

      const fetchedDeals = await Promise.all(
        dealIds.map((id) => hubspotFetch(`/crm/v3/objects/deals/${id}?properties=${DEAL_PROPERTIES}`).catch(() => null)),
      );

      const dealResults = fetchedDeals.filter((d): d is HubSpotObjectResult => !!d);
      const ownerEmailsById = new Map<string, string | null>();
      await Promise.all(
        dealResults.map(async (d) => {
          const ownerId = d.properties.hubspot_owner_id;
          if (!ownerId || ownerEmailsById.has(ownerId)) return;
          try {
            const owner = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as { email?: string };
            ownerEmailsById.set(ownerId, owner.email ?? null);
          } catch {
            ownerEmailsById.set(ownerId, null);
          }
        }),
      );

      deals = await Promise.all(
        dealResults.map(async (d) => {
          const ownerId = d.properties.hubspot_owner_id;
          const ownerEmail = ownerId ? ownerEmailsById.get(ownerId) ?? null : null;
          const ownerName = ownerEmail ? (await getOwnerName(ownerEmail))?.fullName ?? null : null;
          return {
            id: d.id,
            name: d.properties.dealname ?? null,
            stage: d.properties.dealstage ?? null,
            ownerEmail,
            ownerName,
            lastActivityDate: d.properties.hs_lastmodifieddate ?? null,
            closeDate: d.properties.closedate ?? null,
            closedLostReasonCategory: d.properties.closed_lost_reason_dropdown ?? null,
            closedLostReasonDetail: d.properties.closed_lost_reason ?? null,
          };
        }),
      );
    } catch {
      // Best-effort.
    }
  }

  const activeInAppUserCount = otherContacts.filter((c) => c.activeInBuilderApp).length;

  return {
    contact,
    company,
    otherContacts,
    activeInAppUserCount,
    deals,
    notesUnreadable: contact.numNotes > 0,
  };
}
