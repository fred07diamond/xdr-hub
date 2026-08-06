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

// TEMPORARY diagnostic (remove once the "0 contacts" report is resolved):
// live-confirmed lifecyclestage IN ["RAW","MEL","QL"] returns 0 raw matches
// even with no company filter applied at all — the rule's configured stage
// values may not be this property's actual internal option values (a custom
// enumeration property's internal `value` can differ from its displayed
// `label` in HubSpot's UI). Fetches the property's real configured options
// once per cold start (module-level flag, not per-page) and logs them so the
// stored values can be compared directly against what's actually valid.
let _loggedLifecycleStageOptions = false;
async function logLifecycleStageOptionsOnce(): Promise<void> {
  if (_loggedLifecycleStageOptions) return;
  _loggedLifecycleStageOptions = true;
  try {
    const prop = (await hubspotFetchWithTimeout("/crm/v3/properties/contacts/lifecyclestage")) as {
      options?: Array<{ label?: string; value?: string; hidden?: boolean }>;
    };
    console.log(
      `[hubspot-contact-search] lifecyclestage property options: ${JSON.stringify(prop.options ?? [])}`,
    );
  } catch (err) {
    console.log(
      `[hubspot-contact-search] failed to fetch lifecyclestage property definition: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Company allow/deny is deliberately NOT pushed into the server-side
// filterGroups below — live-confirmed a real rule with a ~90-company allow
// list returned ZERO contacts despite genuinely-qualifying contacts existing
// in HubSpot. HubSpot's Search API `IN`/`NOT_IN` operators on a free-text
// property like `company` require an exact, character-for-character match
// against the stored value; any casing or whitespace difference between an
// allow-list entry and what's literally typed into HubSpot's `company` field
// on a given contact silently drops that company from ever matching, with no
// error to surface. Applied instead as a case-insensitive, trimmed post-
// filter below — same "server-side filter when it's reliably exact,
// client-side post-filter when matching is fuzzy" discipline
// prospector-client.ts already uses for CommonRoom's company allow-list.
// This still won't catch a genuinely different spelling ("GoPro" vs "GoPro,
// Inc.") — only casing/whitespace — but that's the one class of mismatch a
// long manually-curated list is most likely to actually hit.
function normalizeCompanyName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function searchHubSpotContacts(options: {
  lifecycleStages: string[];
  companyAllowList?: string[];
  companyDenyList?: string[];
  limit: number; // page size hint for THIS ONE call, not the overall target
  cursor?: string;
}): Promise<HubSpotContactSearchResult> {
  await logLifecycleStageOptionsOnce();

  const result = (await hubspotFetchWithTimeout("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "lifecyclestage", operator: "IN", values: options.lifecycleStages }] },
      ],
      properties: HUBSPOT_CONTACT_PROPERTIES,
      limit: options.limit,
      ...(options.cursor ? { after: options.cursor } : {}),
    }),
  })) as { results?: HubSpotContactRecord[]; paging?: { next?: { after?: string } } };

  const rawRecords = result.results ?? [];
  const nextCursor = result.paging?.next?.after;

  // TEMPORARY diagnostic (remove once the "0 contacts" report is resolved):
  // distinguishes "HubSpot genuinely has no lifecycle-stage matches at all"
  // from "matches exist but the allow/deny filter is excluding all of them"
  // — the two look identical from the run-history UI's "No new prospects"
  // text alone, and this exact ambiguity is what's currently being debugged
  // live.
  if (rawRecords.length === 0) {
    console.log(
      `[hubspot-contact-search] lifecycleStages=${JSON.stringify(options.lifecycleStages)} returned 0 raw matches from HubSpot on this page (cursor=${options.cursor ?? "none"}).`,
    );
  }

  const allowList = new Set(
    (options.companyAllowList ?? []).map(normalizeCompanyName).filter((c): c is string => c !== null),
  );
  const denyList = new Set(
    (options.companyDenyList ?? []).map(normalizeCompanyName).filter((c): c is string => c !== null),
  );
  let records = rawRecords;
  if (allowList.size > 0 || denyList.size > 0) {
    records = rawRecords.filter((r) => {
      const company = normalizeCompanyName(r.properties.company);
      if (allowList.size > 0 && (!company || !allowList.has(company))) return false;
      if (denyList.size > 0 && company && denyList.has(company)) return false;
      return true;
    });
    if (rawRecords.length > 0 && records.length === 0) {
      console.log(
        `[hubspot-contact-search] allow/deny filter excluded ALL ${rawRecords.length} lifecycle-stage matches on this page. ` +
          `Sample raw company values: ${JSON.stringify(rawRecords.slice(0, 10).map((r) => r.properties.company ?? null))}. ` +
          `Allow list (normalized, first 10): ${JSON.stringify([...allowList].slice(0, 10))}`,
      );
    }
  }

  return { records, nextCursor, hasMore: Boolean(nextCursor) };
}
