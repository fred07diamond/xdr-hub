import { fetchCompaniesByOwner } from "@xdr-hub/shared/server";

// A sourcing/marketing rule pinned to a HubSpot owner id (companyAllowListOwnerId
// / companyDenyListOwnerId) resolves that owner's CURRENT book of business live
// at the start of every run and unions it with the rule's static, once-typed
// company list -- not cached, so a rep's book changing between runs is picked
// up automatically. Called once per fresh run start; a resumed/chunked run
// reuses the already-computed, cached list (see run-sourcing-rule-pipeline.ts's
// syncRecords.metadata caching) rather than re-resolving mid-run.
//
// Known edge case, not specially handled: if `ownerId` is set, the owner
// currently has zero companies, AND `staticList` is empty/null, the merged
// result is `[]` -- for an ALLOW list, searchProspectorContacts's own
// "empty array == no filter" convention then admits every company rather
// than none, same ambiguity this pipeline already carries for a
// manually-typed empty allow list (see the ICP-qualification zero-check
// nearby for the one case that IS specially guarded).
export async function unionWithOwnerScopedCompanies(
  staticList: string[] | null | undefined,
  ownerId: string | null | undefined,
): Promise<string[] | undefined> {
  if (!ownerId) return staticList ?? undefined;

  const { companies } = await fetchCompaniesByOwner(ownerId);
  const ownerNames = companies.map((c) => c.name);

  if (!staticList || staticList.length === 0) return ownerNames;

  const seen = new Set(staticList.map((n) => n.toLowerCase()));
  const merged = [...staticList];
  for (const name of ownerNames) {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      merged.push(name);
    }
  }
  return merged;
}
