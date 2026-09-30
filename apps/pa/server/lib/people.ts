// The people a lead can be routed to (D66): saved on the Team page, plus
// everyone PA has seen own a lead or an account, so filling in meeting links
// starts from real names instead of a blank form.
import type { CrmSnapshot } from "../core/crm/port.js";
import type { PaRepository, PersonRecord } from "../core/repo/types.js";
import type { RoutingResult } from "../core/routing/index.js";

export interface PersonRow extends PersonRecord {
  saved: boolean;
  /** Seen as a lead's PA owner, or as an account's owner, on this many leads. */
  seenAsPa: number;
  seenAsAccountOwner: number;
}

export async function listPeopleWithSeen(
  repo: PaRepository,
): Promise<PersonRow[]> {
  const saved = await repo.listPeople();
  const rows = new Map<string, PersonRow>(
    saved.map((person) => [
      person.email,
      { ...person, saved: true, seenAsPa: 0, seenAsAccountOwner: 0 },
    ]),
  );
  const seen = (
    owner:
      | { email?: string; name?: string | null; displayName?: string | null }
      | null
      | undefined,
    kind: "seenAsPa" | "seenAsAccountOwner",
  ) => {
    const email = owner?.email?.toLowerCase();
    if (!email) return;
    const row = rows.get(email) ?? {
      email,
      displayName: owner?.displayName ?? owner?.name ?? null,
      role: null,
      meetingLink: null,
      podAeEmail: null,
      updatedBy: "",
      createdAt: "",
      updatedAt: "",
      saved: false,
      seenAsPa: 0,
      seenAsAccountOwner: 0,
    };
    row.displayName ??= owner?.displayName ?? owner?.name ?? null;
    row[kind] += 1;
    rows.set(email, row);
  };
  for (const engagement of await repo.listEngagements()) {
    const receipts = await repo.listReceipts(engagement.id);
    const last = (kind: string) =>
      [...receipts].reverse().find((receipt) => receipt.kind === kind);
    const routing = last("route")?.ruleResults.routing as
      | RoutingResult
      | undefined;
    seen(routing?.owner, "seenAsPa");
    const snapshot = last("crm_snapshot")?.ruleResults.snapshot as
      | Partial<CrmSnapshot>
      | undefined;
    seen(snapshot?.company?.owner, "seenAsAccountOwner");
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(b.saved) - Number(a.saved) ||
      (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email),
  );
}
