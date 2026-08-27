import { callMcpTool, mergedConfigKey, type StoredRemoteMcpServer } from "@agent-native/core/mcp-client";

// CommonRoom's public REST/SCIM APIs have no bulk contact/segment-member
// listing endpoint — only the vendor's own remote MCP server
// (https://mcp.commonroom.io/mcp) supports it, and that server is OAuth-2.1
// only (no static bearer token). So this app connects to it as an org-scoped
// MCP server (via Manage agent > Connections > Add your own) instead of a
// plain fetch()-based REST client, and calls its tools through the
// framework's MCP client manager.
const SERVER_NAME = "commonroom";

// orgId must come from the calling action's own ctx.orgId, not the ambient
// getRequestOrgId() global — that reads a different "current org" concept
// than the one the MCP Connections org-scope feature stores servers under,
// and returns undefined here even inside a real authenticated request.
export function resolveServerId(orgId: string | null | undefined): string {
  if (!orgId) {
    throw new Error("CommonRoom sync requires an active organization context.");
  }
  // mergedConfigKey only reads `.name` from the second argument at runtime —
  // this reconstructs the manager's server id for the org-scoped connection
  // added under this exact name, without needing to look up the stored row.
  return mergedConfigKey("org", { name: SERVER_NAME } as StoredRemoteMcpServer, orgId);
}

// callMcpTool has no built-in timeout or abort signal — a stalled MCP
// connection (confirmed to happen live: a run-sourcing-rule-pipeline call
// hung indefinitely at 0% CPU, meaning it was blocked on a network call that
// never returned) leaves the awaiting call, and everything sequenced after
// it, stuck forever with no error and no recovery. This races the call
// against a timeout the same way @xdr-hub/shared/server's withTimeout()
// does (same "can't cancel the callee, but can stop waiting on it" logic),
// but doesn't reuse that helper directly: the breaker below needs to tell
// "the timeout fired" apart from "CommonRoom answered and the answer was an
// error", which means tagging the timeout's own rejection (see STALLED
// below) -- a capability the shared helper doesn't need for its one caller
// (HubSpot) and shouldn't grow just for this.
const DEFAULT_MCP_TIMEOUT_MS = 20_000;

// Marks an error as "the connection stalled", as opposed to "CommonRoom
// answered and the answer was an error". Only stalls feed the breaker below:
// a real tool error (a bad filter field, an unknown objectType) proves the
// connection is alive and is a caller bug, not an outage — counting those
// would let one malformed query trip the breaker for every other caller.
const STALLED = Symbol("commonroom-stalled");

function isStallError(err: unknown): boolean {
  return !!err && typeof err === "object" && STALLED in err;
}

// Once a connection is genuinely stalled, every subsequent call still pays
// the full 20s timeout before failing. Under the unattended scheduled runs
// this app is moving toward, that turns one dead connection into minutes of
// dead wall-clock inside a function invocation with a hard 75s ceiling --
// the run burns its whole budget waiting on a connection that is not coming
// back, and does less real work than if it had given up immediately.
//
// So: after BREAKER_FAILURE_THRESHOLD consecutive stalls against one server,
// fail fast for BREAKER_COOLDOWN_MS instead of waiting on it. Any single
// success (or any real answer, including an error answer) proves the
// connection is alive again and resets the count.
//
// Module-level in-memory state, with the same serverless caveat as
// commonroom-engagement.ts's leadScoreIdCache: a cold function instance
// starts with a clean breaker, so this does NOT guarantee cross-invocation
// protection in production. It DOES guarantee that within one invocation --
// exactly where the 75s ceiling bites -- a dead connection costs one timeout
// rather than one per call, which is the actual problem being solved.
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  consecutiveStalls: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();

function getBreaker(serverId: string): BreakerState {
  let state = breakers.get(serverId);
  if (!state) {
    state = { consecutiveStalls: 0, openUntil: 0 };
    breakers.set(serverId, state);
  }
  return state;
}

/** Test seam -- module-level breaker state would otherwise leak between tests. */
export function resetCommonRoomBreaker(): void {
  breakers.clear();
}

// The framework sets a container-global MCP manager during its agent-chat
// plugin's own async init, but a request can reach this call before that
// init has finished on a freshly spun-up container -- confirmed live,
// repeatedly, via "Find prospects now" (a sporadically-clicked button, so
// it disproportionately lands on cold containers) failing every time with
// the framework's own "MCP client is not configured." (a distinct condition
// from a real CommonRoom-side stall or error; nothing about CommonRoom's
// own health). Confirmed NOT a permanent per-app failure either: this app's
// Chat feature (same plugin, same init) works fine, and CommonRoom's own
// Connections page shows a healthy "Connected" status -- meaning the plugin
// DOES finish initializing, just not always within a short window on a cold
// start. An earlier, shorter retry budget (1s/2s/4s = 7s total) was NOT
// enough and still failed every time; this app's full agent-chat plugin
// init is heavier than that. Budgeted well inside the platform's ~75s
// function timeout, leaving headroom for the actual search work after.
// Deliberately NOT fed into the stall breaker below -- that breaker exists
// for CommonRoom's OWN responsiveness, and this has nothing to do with it.
const MCP_NOT_CONFIGURED_MESSAGE = "MCP client is not configured";
const MCP_NOT_CONFIGURED_RETRY_DELAYS_MS = [3000, 6000, 10000, 15000];

function isMcpNotConfiguredError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(MCP_NOT_CONFIGURED_MESSAGE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callMcpToolWithTimeout(
  serverId: string,
  toolName: string,
  args?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
): Promise<unknown> {
  const breaker = getBreaker(serverId);
  if (Date.now() < breaker.openUntil) {
    // Deliberately NOT flagged as a stall: this is the breaker reporting a
    // known-bad connection, not new evidence of one. Flagging it would let
    // the breaker feed itself and extend its own cooldown indefinitely.
    throw new Error(
      `CommonRoom is not responding (${breaker.consecutiveStalls} consecutive stalled calls) — skipping "${toolName}" until the connection recovers.`,
    );
  }

  for (const delayMs of MCP_NOT_CONFIGURED_RETRY_DELAYS_MS) {
    try {
      return await attemptCall(serverId, toolName, args, timeoutMs, breaker);
    } catch (err) {
      if (!isMcpNotConfiguredError(err)) throw err;
      await sleep(delayMs);
    }
  }
  // Final attempt — let its error (whatever it is) propagate unchanged.
  return attemptCall(serverId, toolName, args, timeoutMs, breaker);
}

async function attemptCall(
  serverId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  timeoutMs: number,
  breaker: BreakerState,
): Promise<unknown> {
  try {
    const result = await Promise.race([
      callMcpTool(serverId, toolName, args),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              Object.assign(
                new Error(`CommonRoom MCP call "${toolName}" timed out after ${timeoutMs}ms — the connection may have stalled.`),
                { [STALLED]: true },
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    breaker.consecutiveStalls = 0;
    breaker.openUntil = 0;
    return result;
  } catch (err) {
    if (isStallError(err)) {
      breaker.consecutiveStalls += 1;
      if (breaker.consecutiveStalls >= BREAKER_FAILURE_THRESHOLD) {
        breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      }
    } else {
      // CommonRoom answered, even if the answer was an error -- the
      // connection is alive, so any stall streak is over.
      breaker.consecutiveStalls = 0;
      breaker.openUntil = 0;
    }
    throw err;
  }
}

export function parseMcpToolResult(result: unknown): unknown {
  const withStructured = result as { structuredContent?: unknown; content?: unknown; isError?: boolean } | null;
  const content = withStructured?.content;
  const textPart = Array.isArray(content)
    ? content.find(
        (part): part is { type: "text"; text: string } =>
          !!part && typeof part === "object" && (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
    : undefined;
  if (withStructured?.isError) {
    throw new Error(textPart?.text ?? "CommonRoom MCP tool call failed.");
  }
  if (withStructured?.structuredContent) return withStructured.structuredContent;
  if (textPart) {
    try {
      return JSON.parse(textPart.text);
    } catch {
      return textPart.text;
    }
  }
  return result;
}

export interface CommonRoomContact {
  id: string;
  name?: string;
  primaryEmail?: string;
  title?: string;
  companyName?: string;
  // Catalog lists `location` as an allowedColumn on Contact but doesn't
  // specify its exact return shape — could come back as a plain country
  // string or as a structured object with a `.country` field. Callers
  // (sync-commonroom.ts) must parse this defensively rather than assume
  // either shape.
  location?: string | { country?: string | null } | null;
}

export interface CommonRoomListResult<T> {
  total: number;
  count: number;
  nextCursor?: string;
  has_more: boolean;
  records: T[];
}

export async function commonroomListContactsInSegment(options: {
  orgId: string | null | undefined;
  segmentId: string;
  limit: number;
  cursor?: string;
}): Promise<CommonRoomListResult<CommonRoomContact>> {
  const result = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Contact",
    filter: {
      type: "and",
      clauses: [
        {
          type: "stringListFilter",
          field: "memberSegmentId",
          params: { op: "any", value: [options.segmentId] },
        },
      ],
    },
    properties: ["primaryEmail", "title", "companyName", "location"],
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });
  return parseMcpToolResult(result) as CommonRoomListResult<CommonRoomContact>;
}

// Defensive parse of CommonRoom's Contact.location property into a plain
// country string for computeDeterministicCompanyFit(). The catalog lists
// `location` as an allowedColumn on Contact but doesn't specify its exact
// return shape, and this can't be verified against a live CommonRoom
// session in this environment — so this handles a plain string (treated as
// the country directly), an object with a `.country` field, or anything
// else/unparseable by returning `null` rather than storing garbage.
export function parseCommonRoomLocationCountry(location: CommonRoomContact["location"]): string | null {
  if (typeof location === "string") {
    const trimmed = location.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (location && typeof location === "object" && typeof location.country === "string") {
    const trimmed = location.country.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

export async function commonroomListSegments(options: {
  orgId: string | null | undefined;
  limit: number;
  cursor?: string;
}): Promise<CommonRoomListResult<{ id: string; name: string }>> {
  const result = await callMcpToolWithTimeout(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Segment",
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });
  return parseMcpToolResult(result) as CommonRoomListResult<{ id: string; name: string }>;
}
