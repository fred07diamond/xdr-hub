import { beforeEach, describe, expect, it, vi } from "vitest";

const hubspotFetchWithTimeout = vi.fn();

vi.mock("@xdr-hub/shared/server", () => ({
  hubspotFetchWithTimeout: (...args: unknown[]) => hubspotFetchWithTimeout(...args),
}));

import { searchHubSpotContacts } from "../server/helpers/hubspot-contact-search.js";

describe("searchHubSpotContacts", () => {
  beforeEach(() => {
    hubspotFetchWithTimeout.mockReset();
  });

  it("filters by lifecyclestage IN, no company filters when neither list is given", async () => {
    hubspotFetchWithTimeout.mockResolvedValueOnce({ results: [], paging: undefined });

    await searchHubSpotContacts({ lifecycleStages: ["RAW", "MEL", "QL"], limit: 100 });

    expect(hubspotFetchWithTimeout).toHaveBeenCalledTimes(1);
    const [path, options] = hubspotFetchWithTimeout.mock.calls[0];
    expect(path).toBe("/crm/v3/objects/contacts/search");
    const body = JSON.parse((options as { body: string }).body);
    expect(body.filterGroups).toEqual([
      { filters: [{ propertyName: "lifecyclestage", operator: "IN", values: ["RAW", "MEL", "QL"] }] },
    ]);
  });

  // HubSpot's filterGroups are OR'd together; a single group's `filters`
  // array is AND'd — company allow/deny must live in the SAME group as the
  // lifecycle-stage filter, not a separate group (a separate group would OR
  // them, matching a contact that satisfies ANY one filter rather than all).
  it("ANDs lifecycle stage with company allow/deny in a single filter group", async () => {
    hubspotFetchWithTimeout.mockResolvedValueOnce({ results: [], paging: undefined });

    await searchHubSpotContacts({
      lifecycleStages: ["RAW"],
      companyAllowList: ["Acme", "Globex"],
      companyDenyList: ["Initech"],
      limit: 100,
    });

    const [, options] = hubspotFetchWithTimeout.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.filterGroups).toHaveLength(1);
    expect(body.filterGroups[0].filters).toEqual([
      { propertyName: "lifecyclestage", operator: "IN", values: ["RAW"] },
      { propertyName: "company", operator: "IN", values: ["Acme", "Globex"] },
      { propertyName: "company", operator: "NOT_IN", values: ["Initech"] },
    ]);
  });

  it("passes the cursor through as `after` and reports hasMore from paging.next.after", async () => {
    hubspotFetchWithTimeout.mockResolvedValueOnce({
      results: [{ id: "1", properties: {} }],
      paging: { next: { after: "cursor-2" } },
    });

    const result = await searchHubSpotContacts({ lifecycleStages: ["RAW"], limit: 50, cursor: "cursor-1" });

    const [, options] = hubspotFetchWithTimeout.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.after).toBe("cursor-1");
    expect(result.nextCursor).toBe("cursor-2");
    expect(result.hasMore).toBe(true);
  });

  it("reports hasMore: false when there's no next cursor", async () => {
    hubspotFetchWithTimeout.mockResolvedValueOnce({ results: [], paging: {} });

    const result = await searchHubSpotContacts({ lifecycleStages: ["RAW"], limit: 50 });

    expect(result.nextCursor).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });
});
