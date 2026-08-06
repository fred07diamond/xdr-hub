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

// Company allow/deny IS pushed into the server-side filterGroups below —
// reverted from an earlier attempt to move this to a client-side post-filter
// instead. That attempt was based on an unconfirmed theory (HubSpot's `IN`
// operator being case-sensitive on the free-text `company` property) guessed
// from the "0 contacts" symptom, which turned out to have a completely
// different, confirmed root cause (see resolveLifecycleStageLabelToValue
// below) — the company filter was very likely never actually broken. Live-
// confirmed removing it from the server-side query WAS a real, worse bug:
// without any company narrowing, this portal's lifecycle-stage-only pool
// paged past HubSpot's hard 10,000-result Search API ceiling
// ("after":"10000" -> a 400 with no useful detail) before ever completing,
// aborting an otherwise-successful run and its already-found progress. A
// smaller (or case-mismatched) result set from an exact server-side filter
// is a far safer failure mode than a hard crash that erases real progress —
// if a genuine casing mismatch ever surfaces later, revisit narrowing
// separately, but don't reintroduce the unbounded-pool crash to fix it.
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

  const filters: unknown[] = [{ propertyName: "lifecyclestage", operator: "IN", values: resolvedStageValues }];
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
