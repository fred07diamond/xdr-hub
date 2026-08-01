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
// it, stuck forever with no error and no recovery. Promise.race can't cancel
// the underlying call (the framework gives us no cancellation hook), but it
// lets OUR code stop waiting and treat a stalled connection as a failure —
// converting an indefinite hang into a normal, catchable error that the
// existing "CommonRoom hiccup -> null signal, never fail the whole
// operation" handling (score-contact.ts, prospector-client.ts) already
// knows how to absorb.
const DEFAULT_MCP_TIMEOUT_MS = 20_000;

export async function callMcpToolWithTimeout(
  serverId: string,
  toolName: string,
  args?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_MCP_TIMEOUT_MS,
): Promise<unknown> {
  return Promise.race([
    callMcpTool(serverId, toolName, args),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`CommonRoom MCP call "${toolName}" timed out after ${timeoutMs}ms — the connection may have stalled.`)),
        timeoutMs,
      ),
    ),
  ]);
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
