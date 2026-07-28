import { hubspotFetch } from "./hubspot-client.js";

export async function createHubspotDeal({
  dealName,
  associatedContact,
  company,
  aeEmail,
  crmNotes,
}: {
  dealName: string;
  associatedContact: string;
  company: string;
  aeEmail: string;
  crmNotes: string;
}): Promise<{ dealId: string }> {
  // Look up the HubSpot owner ID for the AE
  const owners = (await hubspotFetch(
    `/crm/v3/owners?email=${encodeURIComponent(aeEmail)}&limit=1`
  )) as { results?: Array<{ id: string }> };
  const ownerId = owners.results?.[0]?.id;

  const properties: Record<string, string> = {
    dealname: dealName,
    dealstage: "appointmentscheduled",
    pipeline: "default",
    description: `Contact: ${associatedContact}\nCompany: ${company}\n\n${crmNotes}`,
  };
  if (ownerId) properties.hubspot_owner_id = ownerId;

  const deal = (await hubspotFetch("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })) as { id: string };

  return { dealId: deal.id };
}
