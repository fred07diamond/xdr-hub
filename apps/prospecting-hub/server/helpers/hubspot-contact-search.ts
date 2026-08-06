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

// Live-confirmed (via HubSpot's own property-definition endpoint) that this
// portal's `lifecyclestage` is a custom enumeration whose internal filter
// `value` is a numeric ID completely different from its displayed `label` —
// e.g. label "RAW" has internal value "152478580", "MEL" is "152484760", etc.
// A normal GET/read of a contact's `lifecyclestage` (sync-hubspot.ts,
// contacts.lifecycleStage) returns the LABEL — a known HubSpot quirk specific
// to this one property — which is also naturally what a human configuring a
// Marketing rule would type/select. But the Search API's `IN` filter matches
// against the internal VALUE, not the label: sending "RAW" as a filter value
// live-confirmed 0 matches even though contacts with that stage genuinely
// exist. Resolving label -> value here, right before building the filter, so
// every other part of the app (display, storage, rule configuration) keeps
// working with the human-readable label it already uses.
const LIFECYCLE_STAGE_MAP_CACHE_TTL_MS = 10 * 60_000;
let _lifecycleStageMapCache: { map: Map<string, string>; expiresAt: number } | null = null;

async function resolveLifecycleStageLabelToValue(): Promise<Map<string, string>> {
  if (_lifecycleStageMapCache && Date.now() < _lifecycleStageMapCache.expiresAt) {
    return _lifecycleStageMapCache.map;
  }
  const prop = (await hubspotFetchWithTimeout("/crm/v3/properties/contacts/lifecyclestage")) as {
    options?: Array<{ label?: string; value?: string }>;
  };
  const map = new Map<string, string>();
  for (const opt of prop.options ?? []) {
    if (opt.label && opt.value) map.set(opt.label.trim().toLowerCase(), opt.value);
  }
  _lifecycleStageMapCache = { map, expiresAt: Date.now() + LIFECYCLE_STAGE_MAP_CACHE_TTL_MS };
  return map;
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
  const stageLabelToValue = await resolveLifecycleStageLabelToValue();
  // Falls back to the raw configured string when a stage isn't found in the
  // live options map (e.g. a genuinely stale/renamed stage) rather than
  // dropping it silently — an unresolved value still fails the same way the
  // bug being fixed here did, but resolution failures should be visible in
  // that stage simply never matching, not swallowed into "resolved to
  // nothing" and quietly narrowing the filter.
  const resolvedStageValues = options.lifecycleStages.map(
    (stage) => stageLabelToValue.get(stage.trim().toLowerCase()) ?? stage,
  );

  const result = (await hubspotFetchWithTimeout("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: "lifecyclestage", operator: "IN", values: resolvedStageValues }] },
      ],
      properties: HUBSPOT_CONTACT_PROPERTIES,
      limit: options.limit,
      ...(options.cursor ? { after: options.cursor } : {}),
    }),
  })) as { results?: HubSpotContactRecord[]; paging?: { next?: { after?: string } } };

  const rawRecords = result.results ?? [];
  const nextCursor = result.paging?.next?.after;

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
  }

  return { records, nextCursor, hasMore: Boolean(nextCursor) };
}
