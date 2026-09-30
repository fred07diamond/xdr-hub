// CRM mapping (D48) and CRM connections (D47), against synthetic HubSpot
// property definitions. No live calls.
import { afterEach, describe, expect, it, vi } from "vitest";

import recorded from "../../fixtures/hubspot-properties.synthetic.json";
import { checkChange } from "../../server/core/playbook/checks.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import type { ChangeItemRecord } from "../../server/core/repo/types.js";
import { toPortalProperty } from "../../server/lib/crm-schema.js";
import {
  canonicalField,
  incompatibility,
  mappingProblems,
  suggestMappings,
  type PortalSchema,
} from "../../shared/crm-mapping.js";

const portal: PortalSchema = {
  fetchedAt: "2026-09-30T17:00:00.000Z",
  objects: {
    contacts: recorded.contacts
      .filter((item) => !("archived" in item && item.archived))
      .map(toPortalProperty),
    companies: recorded.companies.map(toPortalProperty),
    deals: recorded.deals.map(toPortalProperty),
  },
};
const mappingItem = (after: unknown): ChangeItemRecord => ({
  id: "i",
  changeId: "c",
  target: "config.hubspot_mapping",
  op: "set_config",
  beforeValue: null,
  afterValue: after,
  ownerTeam: "revops",
  createdAt: portal.fetchedAt,
  updatedAt: portal.fetchedAt,
});

describe("mapping types and suggestions", () => {
  it("normalizes HubSpot definitions and keeps no record data", () => {
    const last = portal.objects.contacts!.find(
      (p) => p.name === "notes_last_updated",
    )!;
    expect(last).toMatchObject({
      type: "datetime",
      readOnlyValue: true,
      hubspotDefined: true,
    });
    expect(Object.keys(last).sort()).toEqual(
      [
        "calculated",
        "description",
        "fieldType",
        "groupName",
        "hidden",
        "hubspotDefined",
        "label",
        "name",
        "options",
        "readOnlyValue",
        "referencedObjectType",
        "type",
      ].sort(),
    );
  });

  it("only offers properties whose type fits the field", () => {
    const owner = canonicalField("contact.owner")!;
    const firstname = portal.objects.contacts!.find(
      (p) => p.name === "firstname",
    )!;
    expect(incompatibility(owner, firstname)).toMatch(/not an owner/);
    expect(
      incompatibility(
        owner,
        portal.objects.contacts!.find((p) => p.name === "hubspot_owner_id")!,
      ),
    ).toBeNull();
  });

  it("proposes the last activity date for the unmapped field, never a wrong type", () => {
    const suggestions = suggestMappings(
      seedRelease.config.hubspot_mapping,
      portal,
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        field: "contact.last_activity",
        property: "notes_last_updated",
      }),
    );
    expect(suggestions.every((s) => s.property !== "firstname")).toBe(true);
  });

  it("checks the SAL value against the lifecycle property's own options", () => {
    const good = {
      ...seedRelease.config.hubspot_mapping,
      lifecycle_values: { sal: "1234567" },
    };
    const bad = {
      ...seedRelease.config.hubspot_mapping,
      lifecycle_values: { sal: "salesacceptedlead" },
    };
    expect(
      mappingProblems(good, portal).filter(
        (p) => p.field === "contact.sal_value",
      ),
    ).toEqual([]);
    expect(mappingProblems(bad, portal).map((p) => p.field)).toContain(
      "contact.sal_value",
    );
  });
});

describe("portal checks on playbook changes", () => {
  it("blocks a mapping change that points at a property the portal does not have", () => {
    const mapping = {
      ...seedRelease.config.hubspot_mapping,
      contact: {
        ...(seedRelease.config.hubspot_mapping.contact as object),
        owner: "no_such_owner",
      },
    };
    const result = checkChange(
      seedRelease,
      [mappingItem(mapping)],
      "c",
      "n",
      portal,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toMatch(/does not exist/);
  });

  it("accepts a mapping that fits, and a fitting SAL value clears the RevOps request", () => {
    const mapping = {
      ...seedRelease.config.hubspot_mapping,
      contact: {
        ...(seedRelease.config.hubspot_mapping.contact as object),
        last_activity: "notes_last_updated",
      },
      lifecycle_values: { sal: "1234567" },
    };
    const result = checkChange(
      seedRelease,
      [mappingItem(mapping)],
      "c",
      "n",
      portal,
    );
    expect(result.ok).toBe(true);
    const keys = result.findings.map((f) => f.dedupeKey);
    expect(keys).not.toContain("crm_field:map:contact.sal_value");
    expect(keys).not.toContain("crm_field:map:contact.last_activity");
  });
});

describe("CRM connections", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@agent-native/core/secrets");
    vi.resetModules();
  });

  it("tests a token with one read-only call and explains rejections", async () => {
    const { testHubSpotToken } =
      await import("../../server/lib/crm-connections.js");
    const calls: string[] = [];
    for (const [status, expected] of [
      [200, true],
      [401, false],
      [403, false],
    ] as const) {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(
        async (url, init) => {
          calls.push(
            `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}`,
          );
          return new Response("{}", { status });
        },
      );
      const result = await testHubSpotToken("pat-test-token");
      expect(result.ok).toBe(expected);
    }
    expect(
      calls.every(
        (call) => call === "GET https://api.hubapi.com/crm/v3/owners?limit=1",
      ),
    ).toBe(true);
  });

  it("saves tokens only at org scope, where every xDR Hub app reads them", async () => {
    const writeAppSecret = vi.fn(async () => "id");
    vi.doMock("@agent-native/core/secrets", () => ({
      writeAppSecret,
      readAppSecret: vi.fn(),
      deleteAppSecret: vi.fn(),
      getAppSecretMeta: vi.fn(),
    }));
    const { saveCrmToken } =
      await import("../../server/lib/crm-connections.js");
    await saveCrmToken("hubspot", "org-1", "pat-test-token");
    expect(writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "HUBSPOT_ACCESS_TOKEN",
        scope: "org",
        scopeId: "org-1",
        value: "pat-test-token",
      }),
    );
  });
});
