import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

interface NotionRichText {
  plain_text?: string;
}

interface NotionPageResult {
  id: string;
  url?: string;
  last_edited_time?: string;
  icon?: { type?: string; emoji?: string } | null;
  properties?: Record<string, { type?: string; title?: NotionRichText[] }>;
}

function titleFromPage(page: NotionPageResult): string {
  const titleProp = Object.values(page.properties ?? {}).find((p) => p?.type === "title");
  const text = (titleProp?.title ?? []).map((t) => t.plain_text ?? "").join("");
  return text.trim() || "Untitled";
}

// Notion 401/403/404 on /search itself (as opposed to a specific page) means
// the workspace connection isn't set up at all, or li-agent's app-access
// grant for it was switched to manual and never turned on -- surface that
// distinction rather than a bare HTTP status.
function friendlyError(status: number, guidance: string | null | undefined): string {
  if (status === 401 || status === 403) {
    return (
      "Notion isn't connected for this app yet. Connect Notion in Dispatch under " +
      "Integrations, or make sure li-agent has been granted access to it there." +
      (guidance ? ` ${guidance}` : "")
    );
  }
  return `Notion search failed (HTTP ${status}).${guidance ? ` ${guidance}` : ""}`;
}

export default defineAction({
  description:
    "Search the workspace's connected Notion pages by title/content, for attaching one as an ICP persona document.",
  schema: z.object({
    query: z.string().min(1).max(200).describe("Search text to match against Notion page titles/content"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  readOnly: true,
  run: async ({ query, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);

    const result = await executeProviderApiRequest({
      provider: "notion",
      method: "POST",
      path: "/search",
      body: {
        query,
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 20,
      },
    });

    if (!result.response.ok) {
      return {
        ok: false as const,
        error: friendlyError(result.response.status, result.guidance),
      };
    }

    const json = result.response.json as { results?: NotionPageResult[] } | undefined;
    const results = Array.isArray(json?.results) ? json.results : [];

    return {
      ok: true as const,
      pages: results.map((page) => ({
        id: page.id,
        title: titleFromPage(page),
        url: page.url ?? null,
        lastEditedTime: page.last_edited_time ?? null,
        icon: page.icon?.type === "emoji" ? page.icon.emoji ?? null : null,
      })),
    };
  },
});
