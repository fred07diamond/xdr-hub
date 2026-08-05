import { hubspotFetchWithTimeout } from "@xdr-hub/shared/server";
import { HUBSPOT_CONTACT_PROPERTIES, type HubSpotContactRecord } from "./hubspot-contact-properties.js";

// HubSpot Search API analog of prospector-client.ts's searchProspectorContacts
// — same "one page per call, caller follows the cursor across however many
// invocations it takes" contract, so run-marketing-rule-pipeline.ts can page
// through it with the exact same resumable/time-budgeted loop shape already
// proven for CommonRoom Prospector search.
//
// HubSpot's filterGroups are OR'd together; a single group's `filters` array
// is AND'd — so "lifecyclestage IN [...] AND company IN [...] AND company
// NOT_IN [...]" all belong in ONE group, not separate groups (separate
// groups would OR them, matching a contact that satisfies ANY one filter
// rather than all of them).
export interface HubSpotContactSearchResult {
  records: HubSpotContactRecord[];
  nextCursor?: string;
  hasMore: boolean;
}

export async function searchHubSpotContacts(options: {
  lifecycleStages: string[];
  companyAllowList?: string[];
  companyDenyList?: string[];
  limit: number; // page size hint for THIS ONE call, not the overall target
  cursor?: string;
}): Promise<HubSpotContactSearchResult> {
  const filters: unknown[] = [
    { propertyName: "lifecyclestage", operator: "IN", values: options.lifecycleStages },
  ];
  const allowList = options.companyAllowList?.filter(Boolean) ?? [];
  if (allowList.length > 0) {
    filters.push({ propertyName: "company", operator: "IN", values: allowList });
  }
  const denyList = options.companyDenyList?.filter(Boolean) ?? [];
  if (denyList.length > 0) {
    filters.push({ propertyName: "company", operator: "NOT_IN", values: denyList });
  }

  const result = (await hubspotFetchWithTimeout("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters }],
      properties: HUBSPOT_CONTACT_PROPERTIES,
      limit: options.limit,
      ...(options.cursor ? { after: options.cursor } : {}),
    }),
  })) as { results?: HubSpotContactRecord[]; paging?: { next?: { after?: string } } };

  const records = result.results ?? [];
  const nextCursor = result.paging?.next?.after;

  return { records, nextCursor, hasMore: Boolean(nextCursor) };
}
