/**
 * Regression test for the resolveLeadScoreIds caching fix (see
 * server/helpers/commonroom-engagement.ts).
 *
 * Root cause being guarded against: lookupCommonRoomSignals() used to call
 * resolveLeadScoreIds(orgId) — a fresh commonroom_list_objects("LeadScore")
 * MCP round-trip — on EVERY invocation, even though those IDs are identical
 * for the entire org for the duration of a pipeline run. For a 20-contact
 * sourcing-rule run that was up to 19 completely redundant CommonRoom calls
 * before any per-contact Contact/Organization lookups even started.
 *
 * Mocks commonroom-client.ts's callMcpToolWithTimeout so no live CommonRoom
 * connection is needed — this is a pure caching-logic test.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const callMcpToolWithTimeout = vi.fn();

vi.mock("../server/helpers/commonroom-client.js", () => ({
  callMcpToolWithTimeout: (...args: unknown[]) => callMcpToolWithTimeout(...args),
  // The mocked callMcpToolWithTimeout below returns already-parsed records
  // directly, so parseMcpToolResult is just a passthrough here.
  parseMcpToolResult: (result: unknown) => result,
  resolveServerId: (orgId: string | null | undefined) => `server:${orgId ?? "none"}`,
}));

import { lookupCommonRoomSignals } from "../server/helpers/commonroom-engagement.js";

function mockCommonRoomResponses() {
  callMcpToolWithTimeout.mockImplementation((_serverId: string, _toolName: string, args: Record<string, unknown>) => {
    if (args.objectType === "LeadScore") {
      return Promise.resolve({
        records: [
          { id: "ls_1", name: "Contact Score V2" },
          { id: "ls_2", name: "Contact Intent Score" },
          { id: "ls_3", name: "Company Fit Score (Common Room)" },
        ],
      });
    }
    if (args.objectType === "Contact") {
      return Promise.resolve({
        records: [
          {
            fullName: "Jane Doe",
            companyName: "Acme",
            leadScores: [
              { scoreId: 1, percentile: 80 },
              { scoreId: 2, percentile: 60 },
            ],
          },
        ],
      });
    }
    if (args.objectType === "Organization") {
      return Promise.resolve({ records: [{ name: "Acme", leadScores: [{ scoreId: 3, percentile: 40 }] }] });
    }
    return Promise.resolve({ records: [] });
  });
}

function leadScoreCallCount() {
  return callMcpToolWithTimeout.mock.calls.filter(([, , args]) => (args as Record<string, unknown>).objectType === "LeadScore").length;
}

describe("resolveLeadScoreIds caching (via lookupCommonRoomSignals)", () => {
  beforeEach(() => {
    callMcpToolWithTimeout.mockReset();
    mockCommonRoomResponses();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-fetch LeadScore IDs on a second call for the same org within the TTL window", async () => {
    const orgId = "org-cache-test-1";

    const first = await lookupCommonRoomSignals({ orgId, fullName: "Jane Doe", companyName: "Acme" });
    expect(leadScoreCallCount()).toBe(1);
    expect(first.commonRoomFitScore).toBe(80);
    expect(first.commonRoomIntentScore).toBe(60);
    expect(first.commonRoomCompanyFitScore).toBe(40);

    const second = await lookupCommonRoomSignals({ orgId, fullName: "Jane Doe", companyName: "Acme" });
    // The LeadScore list itself must NOT be re-fetched — only 1 call total,
    // even though this is the second scoring call for this org.
    expect(leadScoreCallCount()).toBe(1);
    // The per-contact Contact/Organization lookups still happen every call
    // — only the org-wide LeadScore ID resolution is cached.
    expect(callMcpToolWithTimeout.mock.calls.filter(([, , a]) => (a as Record<string, unknown>).objectType === "Contact").length).toBe(2);
    expect(second).toEqual(first);
  });

  it("resolves LeadScore IDs independently per org (cache is keyed by orgId)", async () => {
    await lookupCommonRoomSignals({ orgId: "org-cache-test-2a", fullName: "Jane Doe", companyName: "Acme" });
    await lookupCommonRoomSignals({ orgId: "org-cache-test-2b", fullName: "Jane Doe", companyName: "Acme" });
    // Two distinct orgs -> two distinct cache entries -> two LeadScore fetches.
    expect(leadScoreCallCount()).toBe(2);
  });

  it("re-fetches LeadScore IDs after the TTL expires", async () => {
    vi.useFakeTimers();
    const orgId = "org-cache-test-3";

    await lookupCommonRoomSignals({ orgId, fullName: "Jane Doe", companyName: "Acme" });
    expect(leadScoreCallCount()).toBe(1);

    // Still within the 5-minute TTL — no re-fetch.
    vi.advanceTimersByTime(4 * 60 * 1000);
    await lookupCommonRoomSignals({ orgId, fullName: "Jane Doe", companyName: "Acme" });
    expect(leadScoreCallCount()).toBe(1);

    // Past the 5-minute TTL — must re-fetch.
    vi.advanceTimersByTime(2 * 60 * 1000);
    await lookupCommonRoomSignals({ orgId, fullName: "Jane Doe", companyName: "Acme" });
    expect(leadScoreCallCount()).toBe(2);
  });
});
