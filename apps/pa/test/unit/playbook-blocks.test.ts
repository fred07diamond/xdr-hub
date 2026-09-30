// The block model (D46): every seed block validates against its type, builder
// edits keep what the editor does not show, and new blocks report honestly.
import { describe, expect, it } from "vitest";

import { checkChange } from "../../server/core/playbook/checks.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import type { ReleaseEntry } from "../../server/core/playbook/schema.js";
import type { ChangeItemRecord } from "../../server/core/repo/types.js";
import {
  BLOCK_TYPES,
  blockType,
  newEntryId,
} from "../../shared/playbook-blocks.js";

const at = "2026-09-30T17:00:00.000Z";
const entry = (id: string) =>
  seedRelease.entries.find((item) => item.id === id) as ReleaseEntry;
const item = (
  target: string,
  afterValue: unknown,
  op: ChangeItemRecord["op"] = "update",
): ChangeItemRecord => ({
  id: `i-${target}`,
  changeId: "c",
  target,
  op,
  beforeValue: null,
  afterValue,
  ownerTeam: "revops",
  createdAt: at,
  updatedAt: at,
});

describe("block types", () => {
  it("covers every seed entry, and each entry's data fits its type", () => {
    for (const seeded of seedRelease.entries) {
      const type = blockType(seeded.block);
      expect(type, seeded.id).not.toBeNull();
      expect(
        type!.schema.safeParse(seeded.params ?? {}).success,
        seeded.id,
      ).toBe(true);
      if (type!.storage.kind === "entry")
        expect(seeded.type, seeded.id).toBe(type!.storage.entryType);
      expect(type!.sections, seeded.id).toContain(seeded.section);
    }
  });

  it("validates config blocks too", () => {
    expect(
      blockType("person_pool")!.schema.safeParse(
        seedRelease.config.routing_pool,
      ).success,
    ).toBe(true);
    expect(
      blockType("crm_mapping")!.schema.safeParse(
        seedRelease.config.hubspot_mapping,
      ).success,
    ).toBe(true);
  });

  it("gives every type an empty value its own schema accepts, except those that need input", () => {
    for (const type of BLOCK_TYPES) {
      expect(type.schema.safeParse(type.empty()).success, type.type).toBe(true);
    }
  });

  it("makes unique ids for new blocks", () => {
    const type = blockType("country_list")!;
    const taken = new Set(["rule.rules_of_engagement.priority_countries"]);
    expect(
      newEntryId(type, "rules_of_engagement", "Priority countries", taken),
    ).toBe("rule.rules_of_engagement.priority_countries_2");
  });
});

describe("builder edits", () => {
  it("adds a country by editing the block, and keeps fields the editor does not show", () => {
    const raw = entry("rule.precheck.restricted_countries");
    const after = { ...raw, params: { countries: ["CU", "IR"] } };
    const result = checkChange(seedRelease, [item(raw.id, after)], "c", "n");
    expect(result.ok).toBe(true);
    const published = result.release!.entries.find((e) => e.id === raw.id)!;
    expect(published.params).toEqual({ countries: ["CU", "IR"] });
    expect(published.precedence).toBe(raw.precedence);
    expect(published.block).toBe("country_list");
    expect(published.section).toBe("rules_of_engagement");

    // The scope on the agency message rule survives an edit to its text.
    const agency = entry("msg.agency.first_touch");
    const edited = checkChange(
      seedRelease,
      [item(agency.id, { ...agency, body: "New text for agencies." })],
      "c",
      "n",
    );
    expect(
      edited.release!.entries.find((e) => e.id === agency.id)!.scope,
    ).toEqual(agency.scope);
  });

  it("blocks data that does not fit the block type", () => {
    const raw = entry("rule.precheck.restricted_countries");
    const result = checkChange(
      seedRelease,
      [item(raw.id, { ...raw, params: { countries: ["Cuba"] } })],
      "c",
      "n",
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/Country list/);
  });

  it("publishes a custom rule as not enforced, with the block type's build brief for the app owner", () => {
    const custom = {
      id: "rule.rules_of_engagement.no_competitor_employees",
      type: "rule",
      block: "custom_rule",
      section: "rules_of_engagement",
      owner: "RevOps",
      owner_team: "revops",
      body: "Do not engage employees of direct competitors.",
      params: { note: "competitor list lives in HubSpot" },
      needs_fields: ["company.is_competitor"],
    };
    const result = checkChange(
      seedRelease,
      [item(custom.id, custom, "add")],
      "c",
      "n",
    );
    expect(result.ok).toBe(true);
    expect(result.pendingBuild).toEqual([custom.id]);
    const feature = result.findings.find(
      (f) => f.dedupeKey === `feature:rule:${custom.id}`,
    )!;
    expect(feature.body).toMatch(/Custom rule block/);
    expect(result.findings.map((f) => f.dedupeKey)).toContain(
      "crm_field:new:company.is_competitor",
    );
  });

  it("asks for a Salesforce adapter when the CRM system block picks Salesforce", () => {
    const crm = entry("rule.crm.system");
    const result = checkChange(
      seedRelease,
      [item(crm.id, { ...crm, params: { system: "salesforce" } })],
      "c",
      "n",
    );
    expect(result.ok).toBe(true);
    expect(result.findings.map((f) => f.dedupeKey)).toContain(
      "feature:value:rule.crm.system.system.salesforce",
    );
  });
});
