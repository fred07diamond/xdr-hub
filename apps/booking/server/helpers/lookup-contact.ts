import { hubspotFetch } from "./hubspot-client.js";

export interface HubSpotEnrichment {
  contactId: string | null;
  prospectName: string | null;
  prospectEmail: string | null;
  company: string | null;
  contactOwnerEmail: string | null; // HubSpot owner of the contact (usually the XDR)
  companyOwnerEmail: string | null; // HubSpot owner of the company (usually the AE)
}

async function getOwnerEmail(ownerId: string): Promise<string | null> {
  try {
    const owner = (await hubspotFetch(`/crm/v3/owners/${ownerId}`)) as { email?: string };
    return owner.email ?? null;
  } catch {
    return null;
  }
}

// Search contacts by name, optionally scoped by company name.
// Returns enriched data: contact + company owners, canonical company name.
export async function lookupContactByName(
  prospectName: string,
  company?: string | null,
): Promise<HubSpotEnrichment> {
  const empty: HubSpotEnrichment = {
    contactId: null,
    prospectName: null,
    prospectEmail: null,
    company: null,
    contactOwnerEmail: null,
    companyOwnerEmail: null,
  };

  try {
    const parts = prospectName.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ");

    // Build filters — require first name, add last name if present
    const nameFilters: object[] = [
      { propertyName: "firstname", operator: "CONTAINS_TOKEN", value: firstName },
    ];
    if (lastName) {
      nameFilters.push({ propertyName: "lastname", operator: "CONTAINS_TOKEN", value: lastName });
    }

    const searchBody: Record<string, unknown> = {
      filterGroups: [{ filters: nameFilters }],
      properties: ["firstname", "lastname", "email", "company", "hubspot_owner_id", "associatedcompanyid"],
      limit: 5,
    };

    const result = (await hubspotFetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify(searchBody),
    })) as { results?: Array<{ id: string; properties: Record<string, string> }> };

    if (!result.results?.length) return empty;

    // If multiple matches, prefer the one whose company name matches
    let contact = result.results[0];
    if (company && result.results.length > 1) {
      const companyLower = company.toLowerCase();
      const match = result.results.find((c) =>
        c.properties.company?.toLowerCase().includes(companyLower),
      );
      if (match) contact = match;
    }

    const { id: contactId, properties } = contact;
    const fullName =
      [properties.firstname, properties.lastname].filter(Boolean).join(" ") || null;
    const contactOwnerId = properties.hubspot_owner_id;

    // Resolve contact owner email
    const contactOwnerEmail = contactOwnerId ? await getOwnerEmail(contactOwnerId) : null;

    // Look up associated company for company owner
    let resolvedCompany: string | null = properties.company ?? null;
    let companyOwnerEmail: string | null = null;

    try {
      const assoc = (await hubspotFetch(
        `/crm/v4/objects/contacts/${contactId}/associations/companies`,
      )) as { results?: Array<{ toObjectId: string }> };

      const companyId = assoc.results?.[0]?.toObjectId;
      if (companyId) {
        const companyObj = (await hubspotFetch(
          `/crm/v3/objects/companies/${companyId}?properties=name,hubspot_owner_id`,
        )) as { properties?: Record<string, string> };

        const companyProps = companyObj.properties ?? {};
        if (companyProps.name) resolvedCompany = companyProps.name;

        if (companyProps.hubspot_owner_id) {
          companyOwnerEmail = await getOwnerEmail(companyProps.hubspot_owner_id);
        }
      }
    } catch {
      // Company lookup is best-effort
    }

    return {
      contactId,
      prospectName: fullName,
      prospectEmail: properties.email ?? null,
      company: resolvedCompany,
      contactOwnerEmail,
      companyOwnerEmail,
    };
  } catch {
    return empty;
  }
}
