import { defineAction } from "@agent-native/core";
import { z } from "zod";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_API_VERSION = "2022-06-28";

export default defineAction({
  description:
    "Search the user's Notion workspace for pages matching a keyword. Returns page titles and IDs for the ICP source picker. Requires NOTION_API_KEY in the environment.",
  schema: z.object({
    keyword: z.string().describe("Search term to find relevant Notion pages"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ keyword }) => {
    const token = process.env.NOTION_API_KEY;
    if (!token) {
      return {
        results: [],
        error: "Notion not connected. Add NOTION_API_KEY to your .env file.",
      };
    }

    const res = await fetch(`${NOTION_API_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
      },
      body: JSON.stringify({
        query: keyword.trim(),
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 20,
      }),
    });

    if (!res.ok) {
      throw new Error(`Notion API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { results: any[] };

    const results = data.results.map((page: any) => {
      const titleProp = Object.values(page.properties || {}).find(
        (v: any) => v?.type === "title",
      ) as any;
      const title =
        (titleProp?.title || []).map((p: any) => p.plain_text || "").join("") ||
        "Untitled";
      return { id: page.id as string, title };
    });

    return { results };
  },
});
