const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";

// Block types that recurse into their own children (toggles, synced blocks,
// list items with nested sub-lists) — everything else is a leaf whose
// rich_text we read directly.
const RECURSABLE_TYPES = new Set(["toggle", "synced_block", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout"]);

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface RichTextSpan {
  plain_text?: string;
}

function extractPlainText(block: NotionBlock): string {
  const body = block[block.type] as { rich_text?: RichTextSpan[] } | undefined;
  const spans = body?.rich_text ?? [];
  return spans.map((s) => s.plain_text ?? "").join("");
}

export function extractNotionPageId(input: string): string {
  const trimmed = input.trim();
  // Accept a raw 32-char id (with or without dashes) or a full Notion URL —
  // the page id is always the last 32 hex chars in the URL's last path segment.
  const match = trimmed.match(/([0-9a-fA-F]{32})(?:\?|$)/) ?? trimmed.match(/^[0-9a-fA-F-]{32,36}$/);
  const raw = (match ? match[0] : trimmed).replace(/-/g, "").slice(0, 32);
  if (raw.length !== 32) {
    throw new Error(`Could not parse a Notion page id from "${input}".`);
  }
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

async function fetchBlockChildren(blockId: string, token: string): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const res = await fetch(`${NOTION_API_BASE}/blocks/${blockId}/children?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_API_VERSION },
    });
    if (!res.ok) {
      throw new Error(`Notion API error fetching blocks: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { results: NotionBlock[]; has_more: boolean; next_cursor: string | null };
    all.push(...data.results);
    cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return all;
}

async function collectText(blockId: string, token: string, depth: number): Promise<string[]> {
  if (depth > 6) return []; // guard against pathological nesting
  const children = await fetchBlockChildren(blockId, token);
  const lines: string[] = [];
  for (const block of children) {
    const text = extractPlainText(block);
    if (text.trim()) lines.push(text);
    if (block.has_children && (RECURSABLE_TYPES.has(block.type) || block.type === "column_list" || block.type === "column")) {
      lines.push(...(await collectText(block.id, token, depth + 1)));
    }
  }
  return lines;
}

export async function fetchNotionPageText(pageIdOrUrl: string): Promise<string> {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new Error("Notion is not connected. Add NOTION_API_KEY to your .env file.");
  }
  const pageId = extractNotionPageId(pageIdOrUrl);
  const lines = await collectText(pageId, token, 0);
  const text = lines.join("\n");
  if (!text.trim()) {
    throw new Error("That Notion page has no readable text, or this integration hasn't been shared with it (share the page with your Notion integration first).");
  }
  return text;
}
