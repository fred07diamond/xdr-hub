/**
 * Unit tests for check-hubspot-contact matching logic.
 *
 * Mocks hubspotFetch so no real token or server is needed.
 * Tests:
 *  1. Exact match — first + last + company
 *  2. Last-name fallback — company stored differently in HubSpot (e.g. "ramp.com" vs "Ramp")
 *  3. Single-result fallback — only one Simon in HubSpot
 *  4. No match — multiple results, none share last name or company
 *  5. isInSequence coercion — "true" string → true, anything else → false
 *  6. xdrOwner — returned when xdr_owner property is set
 *  7. ownerName — resolved from owner API call
 *  8. Debug mode — returns rawProperties and short-circuits before owner/deals calls
 *  9. Missing name param — returns found:false immediately
 * 10. HubSpot API error during search — returns found:false gracefully
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mock modules before importing the action ──────────────────────────────────

vi.mock("../server/helpers/hubspot-client.js", () => ({
  getHubSpotToken: vi.fn().mockReturnValue("pat-test-token"),
  hubspotFetch: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]), // no DB record — forces use of name/company params
        }),
      }),
    }),
  }),
}));

vi.mock("../server/helpers/resolve-owner.js", () => ({
  resolveOwner: () => Promise.resolve(null),
}));

import { hubspotFetch } from "../server/helpers/hubspot-client.js";
import action from "../actions/check-hubspot-contact.js";

const mockFetch = hubspotFetch as ReturnType<typeof vi.fn>;

// Helper: build a fake HubSpot contact result
function makeContact(
  propertyOverrides: Record<string, string> = {},
  id = "123",
): { id: string; properties: Record<string, string> } {
  return {
    id,
    properties: {
      firstname: "Simon",
      lastname: "Corry",
      company: "Ramp",
      lifecyclestage: "raw",
      hs_lead_status: "",
      email: "simon@ramp.com",
      hubspot_owner_id: "456",
      message: "",
      hs_analytics_first_url: "",
      hs_analytics_last_url: "",
      hs_sequences_is_enrolled: "false",
      hs_latest_sequence_enrolled: "",
      xdr_owner: "",
      ...propertyOverrides,
    },
  };
}

// Minimal ctx stub
const ctx = {} as any;

// Default setup: portal ID + owner lookup succeed
function setupHappy(contacts: ReturnType<typeof makeContact>[], ownerName = "Wyatt Caldwell") {
  mockFetch.mockImplementation((path: string) => {
    if (path.includes("/contacts/search")) return Promise.resolve({ results: contacts });
    if (path.includes("/account-info")) return Promise.resolve({ portalId: 9999 });
    if (path.includes("/owners/")) return Promise.resolve({ firstName: ownerName.split(" ")[0], lastName: ownerName.split(" ")[1] });
    if (path.includes("/associations/deals")) return Promise.resolve({ results: [] });
    return Promise.resolve({});
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ── 1. Exact match ────────────────────────────────────────────────────────────

describe("matching — exact first + last + company", () => {
  it("returns found:true for an exact match", async () => {
    setupHappy([makeContact()]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
    expect(result.contactId).toBe("123");
  });
});

// ── 2. Last-name fallback (Simon Corry / ramp.com vs Ramp) ───────────────────

describe("matching — last-name fallback when company differs", () => {
  it("still finds contact when HubSpot company is 'ramp.com' but LinkedIn shows 'Ramp'", async () => {
    setupHappy([makeContact({ company: "ramp.com" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
  });

  it("still finds when HubSpot company is blank but last name matches", async () => {
    setupHappy([makeContact({ company: "" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
  });

  it("picks correct contact when multiple first-name matches exist", async () => {
    setupHappy([
      makeContact({ lastname: "Smith", company: "Acme" }, "111"),
      makeContact({ lastname: "Corry", company: "ramp.com" }, "222"),
      makeContact({ lastname: "Jones", company: "Other" }, "333"),
    ]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
    expect(result.contactId).toBe("222");
  });
});

// ── 3. Single-result fallback ─────────────────────────────────────────────────

describe("matching — single-result fallback", () => {
  it("uses the only result when it exists even if company doesn't match", async () => {
    setupHappy([makeContact({ company: "Something Completely Different", lastname: "" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
  });

  it("does NOT fall back to first result when multiple results and no name/company match", async () => {
    setupHappy([
      makeContact({ lastname: "Smith", company: "Acme" }, "A"),
      makeContact({ lastname: "Jones", company: "Corp" }, "B"),
    ]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(false);
  });
});

// ── 4. isInSequence strict boolean coercion ───────────────────────────────────

describe("isInSequence — string-to-boolean coercion", () => {
  it('returns true when hs_sequences_is_enrolled is "true"', async () => {
    setupHappy([makeContact({ hs_sequences_is_enrolled: "true" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.isInSequence).toBe(true);
  });

  it('returns false when hs_sequences_is_enrolled is "false"', async () => {
    setupHappy([makeContact({ hs_sequences_is_enrolled: "false" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.isInSequence).toBe(false);
  });

  it("returns false when hs_sequences_is_enrolled is missing/null", async () => {
    const contact = makeContact();
    delete (contact.properties as any).hs_sequences_is_enrolled;
    setupHappy([contact]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.isInSequence).toBe(false);
  });
});

// ── 5. xdrOwner ───────────────────────────────────────────────────────────────

describe("xdrOwner", () => {
  it("returns xdrOwner when xdr_owner property is set on the contact", async () => {
    setupHappy([makeContact({ xdr_owner: "Fred Diamond" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.xdrOwner).toBe("Fred Diamond");
  });

  it("returns null xdrOwner when property is blank", async () => {
    setupHappy([makeContact({ xdr_owner: "" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.xdrOwner).toBeNull();
  });
});

// ── 6. ownerName resolved from owner API ─────────────────────────────────────

describe("ownerName", () => {
  it("resolves owner name from hubspot_owner_id", async () => {
    setupHappy([makeContact({ hubspot_owner_id: "456" })], "Wyatt Caldwell");
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.ownerName).toBe("Wyatt Caldwell");
  });

  it("returns null ownerName when hubspot_owner_id is blank", async () => {
    setupHappy([makeContact({ hubspot_owner_id: "" })]);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.ownerName).toBeNull();
  });

  it("does not crash when owner API call fails", async () => {
    mockFetch.mockImplementation((path: string) => {
      if (path.includes("/contacts/search")) return Promise.resolve({ results: [makeContact({ hubspot_owner_id: "456" })] });
      if (path.includes("/account-info")) return Promise.resolve({ portalId: 9999 });
      if (path.includes("/owners/")) return Promise.reject(new Error("Owner API down"));
      if (path.includes("/associations/deals")) return Promise.resolve({ results: [] });
      return Promise.resolve({});
    });
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(true);
    expect(result.ownerName).toBeNull();
  });
});

// ── 7. Debug mode ─────────────────────────────────────────────────────────────

describe("debug mode", () => {
  it("returns rawProperties and skips owner + deals calls", async () => {
    const searchCalled = { owner: false, deals: false };
    mockFetch.mockImplementation((path: string) => {
      if (path.includes("/contacts/search")) return Promise.resolve({ results: [makeContact()] });
      if (path.includes("/owners/")) { searchCalled.owner = true; return Promise.resolve({}); }
      if (path.includes("/associations/deals")) { searchCalled.deals = true; return Promise.resolve({ results: [] }); }
      return Promise.resolve({});
    });
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp", debug: true },
      ctx,
    );
    expect(result.rawProperties).toBeDefined();
    expect(typeof result.rawProperties).toBe("object");
    expect(searchCalled.owner).toBe(false);
    expect(searchCalled.deals).toBe(false);
  });
});

// ── 8. No name param ─────────────────────────────────────────────────────────

describe("missing name param", () => {
  it("returns found:false when no name is provided and no DB record exists", async () => {
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/" },
      ctx,
    );
    expect(result.found).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── 9. HubSpot search API error ───────────────────────────────────────────────

describe("HubSpot API errors", () => {
  it("returns found:false gracefully when search throws", async () => {
    mockFetch.mockImplementation((path: string) => {
      if (path.includes("/contacts/search")) return Promise.reject(new Error("503 Service Unavailable"));
      return Promise.resolve({});
    });
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.found).toBe(false);
    expect(result.connected).toBe(true);
  });

  it("returns connected:false when no HubSpot token is configured", async () => {
    const { getHubSpotToken } = await import("../server/helpers/hubspot-client.js");
    (getHubSpotToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const result = await (action as any).run(
      { profileUrl: "https://linkedin.com/in/simoncorry/", name: "Simon Corry", company: "Ramp" },
      ctx,
    );
    expect(result.connected).toBe(false);
    expect(result.found).toBe(false);
  });
});
