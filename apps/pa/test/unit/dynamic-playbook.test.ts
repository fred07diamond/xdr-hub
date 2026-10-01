// The dynamic playbook (D44): release building, pending confirmations, the
// active label, and the checks that turn changes into suggestions.
import { describe, expect, it } from "vitest";

import {
  auditRelease,
  checkChange,
  requiredTeamsFor,
} from "../../server/core/playbook/checks.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import type { ReleaseEntry } from "../../server/core/playbook/schema.js";
import {
  activeRelease,
  buildRelease,
  itemsFingerprint,
} from "../../server/core/playbook/store.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import type { ChangeItemRecord } from "../../server/core/repo/types.js";

const at = "2026-09-30T17:00:00.000Z";
const entry = (id: string) =>
  seedRelease.entries.find((item) => item.id === id) as ReleaseEntry;

function item(
  target: string,
  afterValue: unknown,
  op: ChangeItemRecord["op"] = "update",
): ChangeItemRecord {
  return {
    id: `item-${target}`,
    changeId: "chg-1",
    target,
    op,
    beforeValue: null,
    afterValue,
    ownerTeam: "revops",
    createdAt: at,
    updatedAt: at,
  };
}

const setCountries = (countries: string[]) =>
  item("rule.precheck.restricted_countries", {
    ...entry("rule.precheck.restricted_countries"),
    params: { countries },
  });

describe("building a release from a change", () => {
  it("bumps the entry version, rehashes, and keeps every other entry", () => {
    const release = buildRelease({
      base: seedRelease,
      items: [setCountries(["CU", "IR"])],
      changeId: "chg-1",
      notes: "n",
      pendingBuild: new Set(),
    });
    expect(release.id).not.toBe(seedRelease.id);
    expect(release.id).toMatch(/^[0-9a-f]{64}$/);
    const updated = release.entries.find(
      (e) => e.id === "rule.precheck.restricted_countries",
    );
    expect(updated?.version).toBe(
      entry("rule.precheck.restricted_countries").version + 1,
    );
    expect(updated?.params).toEqual({ countries: ["CU", "IR"] });
    expect(release.entries).toHaveLength(seedRelease.entries.length);
  });

  it("is deterministic: the same change builds the same release id", () => {
    const build = () =>
      buildRelease({
        base: seedRelease,
        items: [setCountries(["CU"])],
        changeId: "chg-1",
        notes: "n",
        pendingBuild: new Set(),
      });
    expect(build().id).toBe(build().id);
  });

  it("closes a pending confirmation when its value is set, and keeps the rest", () => {
    const before = seedRelease.pending_confirmation.filter(
      (p) => p.entry_id === "rule.precheck.restricted_countries",
    );
    expect(before.length).toBeGreaterThan(0);
    const release = buildRelease({
      base: seedRelease,
      items: [setCountries(["CU"])],
      changeId: "chg-1",
      notes: "n",
      pendingBuild: new Set(),
    });
    expect(
      release.pending_confirmation.filter(
        (p) => p.entry_id === "rule.precheck.restricted_countries",
      ),
    ).toEqual([]);
    expect(release.pending_confirmation).toHaveLength(
      seedRelease.pending_confirmation.length - before.length,
    );
  });

  it("keeps a pending confirmation when an unrelated field of the same entry changes", () => {
    const changed = item("rule.precheck.restricted_countries", {
      ...entry("rule.precheck.restricted_countries"),
      rationale: "Stripe and Builder policy",
    });
    const release = buildRelease({
      base: seedRelease,
      items: [changed],
      changeId: "chg-1",
      notes: "n",
      pendingBuild: new Set(),
    });
    expect(
      release.pending_confirmation.some(
        (p) => p.entry_id === "rule.precheck.restricted_countries",
      ),
    ).toBe(true);
  });

  it("opens a pending confirmation for a TODO typed in the app", () => {
    const pool = item("config.routing_pool", { pool: ["TODO"] }, "set_config");
    const release = buildRelease({
      base: seedRelease,
      items: [pool],
      changeId: "chg-1",
      notes: "n",
      pendingBuild: new Set(),
    });
    expect(
      release.pending_confirmation.some(
        (p) => p.source === "config/routing-pool.yaml",
      ),
    ).toBe(true);
  });

  it("retires an entry instead of deleting it", () => {
    const release = buildRelease({
      base: seedRelease,
      items: [item("kb.partner_program", null, "retire")],
      changeId: "chg-1",
      notes: "n",
      pendingBuild: new Set(),
    });
    expect(
      release.entries.find((e) => e.id === "kb.partner_program")?.status,
    ).toBe("retired");
  });

  it("changes when any item changes, so approvals cannot outlive an edit", () => {
    expect(itemsFingerprint([setCountries(["CU"])])).not.toBe(
      itemsFingerprint([setCountries(["IR"])]),
    );
  });
});

describe("the active release", () => {
  it("imports the seed into an empty database, once", async () => {
    const repo = new MemoryRepository();
    const first = await activeRelease(repo, new Date(at));
    const second = await activeRelease(repo, new Date(at));
    expect(first.id).toBe(seedRelease.id);
    expect(second.id).toBe(seedRelease.id);
    expect((await repo.getLabel("active"))?.version).toBe(1);
  });
});

describe("checks", () => {
  it("blocks invalid params for a rule code evaluates", () => {
    const bad = item("rule.routing.sal_stale_days", {
      ...entry("rule.routing.sal_stale_days"),
      params: { days: -3 },
    });
    const result = checkChange(seedRelease, [bad], "chg-1", "n");
    expect(result.ok).toBe(false);
    expect(result.errors[0].target).toBe("rule.routing.sal_stale_days");
  });

  it("publishes a rule with no evaluator as pending_build and asks the app owner to build it", () => {
    const newRule = item(
      "rule.routing.segment",
      {
        id: "rule.routing.segment",
        type: "rule",
        block: "threshold",
        section: "routing",
        owner: "Sales leadership",
        owner_team: "revops",
        version: 1,
        body: "Enterprise is 4,000+ employees",
        params: { enterprise_min_employees: 4000 },
        needs_fields: ["company.employees"],
      },
      "add",
    );
    const result = checkChange(seedRelease, [newRule], "chg-1", "n");
    expect(result.ok).toBe(true);
    expect(result.pendingBuild).toEqual(["rule.routing.segment"]);
    expect(
      result.release?.entries.find((e) => e.id === "rule.routing.segment")
        ?.status,
    ).toBe("pending_build");
    const keys = result.findings.map((f) => f.dedupeKey);
    expect(keys).toContain("feature:rule:rule.routing.segment");
    // A rule of engagement that needs a CRM field becomes a request to RevOps.
    expect(keys).toContain("crm_field:new:company.employees");
    expect(
      result.findings.find(
        (f) => f.dedupeKey === "crm_field:new:company.employees",
      )?.audience,
    ).toBe("revops");
  });

  it("flags a routing step code cannot run", () => {
    const order = entry("rule.routing.order");
    const changed = item("rule.routing.order", {
      ...order,
      params: {
        ...order.params,
        order: ["existing_active_owner", "segment_round_robin"],
      },
    });
    const keys = checkChange(seedRelease, [changed], "chg-1", "n").findings.map(
      (f) => f.dedupeKey,
    );
    expect(keys).toContain("feature:route_step:segment_round_robin");
  });

  it("clears the RevOps mapping request once the mapping is filled", () => {
    const mapping = {
      ...seedRelease.config.hubspot_mapping,
      lifecycle_values: { sal: "salesqualifiedlead" },
    };
    const keys = checkChange(
      seedRelease,
      [item("config.hubspot_mapping", mapping, "set_config")],
      "chg-1",
      "n",
    ).findings.map((f) => f.dedupeKey);
    expect(keys).not.toContain("crm_field:map:contact.sal_value");
  });

  it("sends every change to the owner or a Playbook admin (D76)", () => {
    const moved = item("def.ql", { ...entry("def.ql"), owner_team: "pa_team" });
    expect(requiredTeamsFor(seedRelease, [moved])).toEqual(["admin"]);
    expect(requiredTeamsFor(seedRelease, [])).toEqual([]);
  });

  it("audits the seed honestly", () => {
    const keys = auditRelease(seedRelease).map((f) => f.dedupeKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "crm_field:map:contact.sal_value",
        "feature:param:rule.sla.first_touch.breach_notify",
        "knowledge:kb.trial_path_partner_led",
      ]),
    );
  });
});

describe("seed upgrades", () => {
  it("replaces an untouched seed import with a newer seed, and never a published release", async () => {
    const repo = new MemoryRepository();
    const older = { ...seedRelease, id: "0".repeat(64), short_id: "00000000" };
    const { toReleaseRecord } =
      await import("../../server/core/playbook/store.js");
    await repo.insertReleaseIfAbsent(toReleaseRecord(older, "active", at));
    await repo.createLabelIfAbsent({
      label: "active",
      releaseId: older.id,
      movedBy: "system:seed-import",
      movedAt: at,
      version: 1,
    });
    expect((await activeRelease(repo, new Date(at))).id).toBe(seedRelease.id);

    const published = new MemoryRepository();
    await published.insertReleaseIfAbsent(toReleaseRecord(older, "active", at));
    await published.createLabelIfAbsent({
      label: "active",
      releaseId: older.id,
      movedBy: "ops@example.com",
      movedAt: at,
      version: 1,
    });
    expect((await activeRelease(published, new Date(at))).id).toBe(older.id);
  });
});
