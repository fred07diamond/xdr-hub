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
function resolveServerId(orgId: string | null | undefined): string {
  if (!orgId) {
    throw new Error("CommonRoom sync requires an active organization context.");
  }
  // mergedConfigKey only reads `.name` from the second argument at runtime —
  // this reconstructs the manager's server id for the org-scoped connection
  // added under this exact name, without needing to look up the stored row.
  return mergedConfigKey("org", { name: SERVER_NAME } as StoredRemoteMcpServer, orgId);
}

function parseMcpToolResult(result: unknown): unknown {
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
  const result = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
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
    properties: ["primaryEmail", "title", "companyName"],
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });
  return parseMcpToolResult(result) as CommonRoomListResult<CommonRoomContact>;
}

export async function commonroomListSegments(options: {
  orgId: string | null | undefined;
  limit: number;
  cursor?: string;
}): Promise<CommonRoomListResult<{ id: string; name: string }>> {
  const result = await callMcpTool(resolveServerId(options.orgId), "commonroom_list_objects", {
    objectType: "Segment",
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
  });
  return parseMcpToolResult(result) as CommonRoomListResult<{ id: string; name: string }>;
}
