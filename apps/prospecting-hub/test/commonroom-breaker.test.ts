/**
 * Tests for the CommonRoom MCP circuit breaker (see
 * server/helpers/commonroom-client.ts).
 *
 * Problem being guarded against: callMcpTool has no timeout or abort hook, so
 * a stalled connection costs a full 20s per call. Under an unattended
 * scheduled run that turns one dead connection into minutes of dead
 * wall-clock inside a function invocation with a hard 75s ceiling. The
 * breaker gives up after a few consecutive stalls instead of paying that
 * timeout over and over.
 *
 * Mocks @agent-native/core/mcp-client so no live CommonRoom connection is
 * needed, and passes a tiny timeoutMs so a "stall" resolves in milliseconds.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

const callMcpTool = vi.fn();

vi.mock("@agent-native/core/mcp-client", () => ({
  callMcpTool: (...args: unknown[]) => callMcpTool(...args),
  mergedConfigKey: (scope: string, server: { name: string }, orgId: string) => `${scope}:${server.name}:${orgId}`,
}));

const { callMcpToolWithTimeout, resetCommonRoomBreaker } = await import("../server/helpers/commonroom-client.js");

const SERVER = "server-a";
const STALL_MS = 10;

/** Never settles -- stands in for a connection blocked on a call that never returns. */
function stall(): Promise<never> {
  return new Promise(() => {});
}

async function expectStall(serverId = SERVER) {
  await expect(callMcpToolWithTimeout(serverId, "commonroom_list_objects", {}, STALL_MS)).rejects.toThrow(/timed out/);
}

describe("CommonRoom circuit breaker", () => {
  beforeEach(() => {
    callMcpTool.mockReset();
    resetCommonRoomBreaker();
  });

  it("keeps attempting the call while consecutive stalls stay under the threshold", async () => {
    callMcpTool.mockImplementation(stall);

    await expectStall();
    await expectStall();

    expect(callMcpTool).toHaveBeenCalledTimes(2);
  });

  it("opens after 3 consecutive stalls and then fails fast without calling MCP again", async () => {
    callMcpTool.mockImplementation(stall);

    await expectStall();
    await expectStall();
    await expectStall();
    expect(callMcpTool).toHaveBeenCalledTimes(3);

    // Fourth call is rejected by the breaker itself: a distinct message, and
    // critically no new MCP call at all.
    await expect(callMcpToolWithTimeout(SERVER, "commonroom_list_objects", {}, STALL_MS)).rejects.toThrow(
      /not responding/,
    );
    expect(callMcpTool).toHaveBeenCalledTimes(3);
  });

  it("scopes the breaker per server, so one stalled connection doesn't block another", async () => {
    callMcpTool.mockImplementation(stall);

    await expectStall("server-a");
    await expectStall("server-a");
    await expectStall("server-a");

    // server-b has its own clean breaker and still gets a real attempt.
    await expectStall("server-b");
    expect(callMcpTool).toHaveBeenCalledTimes(4);
  });

  it("resets the stall streak after a success", async () => {
    callMcpTool.mockImplementation(stall);
    await expectStall();
    await expectStall();

    callMcpTool.mockResolvedValue({ content: [] });
    await expect(callMcpToolWithTimeout(SERVER, "commonroom_list_objects", {}, STALL_MS)).resolves.toEqual({
      content: [],
    });

    // Streak is back to zero, so it takes a fresh 3 stalls to open.
    callMcpTool.mockImplementation(stall);
    await expectStall();
    await expectStall();
    await expectStall();
    await expect(callMcpToolWithTimeout(SERVER, "commonroom_list_objects", {}, STALL_MS)).rejects.toThrow(
      /not responding/,
    );
  });

  it("does not count a real tool error toward the breaker", async () => {
    // CommonRoom answering with an error proves the connection is alive --
    // a malformed query must never trip the breaker for other callers.
    callMcpTool.mockRejectedValue(new Error("Unknown filter field: seniority"));

    for (let i = 0; i < 5; i++) {
      await expect(callMcpToolWithTimeout(SERVER, "commonroom_list_objects", {}, STALL_MS)).rejects.toThrow(
        /Unknown filter field/,
      );
    }

    // Still closed: the 6th call reaches MCP rather than being short-circuited.
    expect(callMcpTool).toHaveBeenCalledTimes(5);
    await expect(callMcpToolWithTimeout(SERVER, "commonroom_list_objects", {}, STALL_MS)).rejects.toThrow(
      /Unknown filter field/,
    );
    expect(callMcpTool).toHaveBeenCalledTimes(6);
  });
});
