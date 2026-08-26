import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { executeProviderApiRequest } from "../server/lib/provider-api.js";
import { requireAdminFromSessionOrToken } from "../server/helpers/require-admin.js";

// Mirrors MAX_DOC_CHARS in packages/shared/src/server/persona-docs.ts --
// stop traversing well before add-persona-documents would reject the doc
// outright, and report the cutoff instead of silently losing the tail.
const MAX_DOC_CHARS = 200_000;
const MAX_BLOCK_DEPTH = 4;
const MAX_BLOCKS_VISITED = 2000;

interface NotionRichText {
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function richTextToPlain(richText: NotionRichText[] | undefined): string {
  return (richText ?? []).map((t) => t.plain_text ?? "").join("");
}

// The framework's Notion connection is deliberately "template-owned" for
// page hydration -- core exposes raw API access only, not block traversal --
// so this walks /blocks/{id}/children by hand rather than relying on
// anything upstream.
function blockText(block: NotionBlock): string {
  const type = block.type;
  const body = block[type] as { rich_text?: NotionRichText[]; cells?: NotionRichText[][] } | undefined;
  if (!body) return "";
  if (Array.isArray(body.cells)) {
    return body.cells.map((cell) => richTextToPlain(cell)).join(" | ");
  }
  return richTextToPlain(body.rich_text);
}

async function collectBlockText(
  blockId: string,
  depth: number,
  state: { chars: number; blocksVisited: number; truncated: boolean },
): Promise<string> {
  if (depth > MAX_BLOCK_DEPTH || state.truncated) return "";

  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    if (state.truncated) break;
    const result = await executeProviderApiRequest({
      provider: "notion",
      method: "GET",
      path: `/blocks/${blockId}/children`,
      query: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    if (!result.response.ok) break;

    const json = result.response.json as
      | { results?: NotionBlock[]; has_more?: boolean; next_cursor?: string }
      | undefined;
    const blocks = json?.results ?? [];

    for (const block of blocks) {
      if (state.blocksVisited >= MAX_BLOCKS_VISITED || state.chars >= MAX_DOC_CHARS) {
        state.truncated = true;
        break;
      }
      state.blocksVisited += 1;
      const text = blockText(block);
      if (text) {
        lines.push(text);
        state.chars += text.length;
      }
      if (block.has_children) {
        const nested = await collectBlockText(block.id, depth + 1, state);
        if (nested) lines.push(nested);
      }
    }

    cursor = json?.has_more ? json.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

export default defineAction({
  description:
    "Fetch a Notion page's full text content (traversing its blocks) so it can be attached as an ICP persona document.",
  schema: z.object({
    pageId: z.string().min(1).describe("Notion page id, as returned by search-notion-persona-docs"),
    title: z.string().nullish().describe("Page title, if already known (skips an extra lookup)"),
    apiToken: z.string().nullish().describe("Personal API token — extension callers only"),
  }),
  requiresAuth: false,
  readOnly: true,
  run: async ({ pageId, title, apiToken }, ctx) => {
    await requireAdminFromSessionOrToken(apiToken, ctx);

    let name = title?.trim() || "";
    if (!name) {
      const pageResult = await executeProviderApiRequest({
        provider: "notion",
        method: "GET",
        path: `/pages/${pageId}`,
      });
      if (pageResult.response.ok) {
        const properties = (pageResult.response.json as { properties?: Record<string, { type?: string; title?: NotionRichText[] }> })?.properties ?? {};
        const titleProp = Object.values(properties).find((p) => p?.type === "title");
        name = richTextToPlain(titleProp?.title).trim();
      }
    }
    if (!name) name = "Untitled Notion page";

    const state = { chars: 0, blocksVisited: 0, truncated: false };
    let text: string;
    try {
      text = await collectBlockText(pageId, 0, state);
    } catch (err) {
      return {
        ok: false as const,
        error:
          err instanceof Error
            ? `Could not read that Notion page: ${err.message}`
            : "Could not read that Notion page.",
      };
    }

    if (!text.trim()) {
      return {
        ok: false as const,
        error:
          "That Notion page has no readable text content (it may only contain images, embeds, or be empty).",
      };
    }

    return {
      ok: true as const,
      name,
      text: text.slice(0, MAX_DOC_CHARS),
      truncated: state.truncated || text.length > MAX_DOC_CHARS,
    };
  },
});
