import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

async function generatePostName(rawText: string): Promise<string> {
  try {
    const ownerCtx = await getOwnerCtx();
    const call = () => completeText({
      systemPrompt:
        "Create a short, memorable title (4–7 words) for this LinkedIn post. " +
        "Reply with ONLY the title, no quotes, no punctuation at the end.",
      input: rawText.slice(0, 300),
      maxOutputTokens: 30,
    });
    const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();
    return result.text.trim().slice(0, 80);
  } catch {
    return rawText.slice(0, 80);
  }
}

export default defineAction({
  description: "Ingest a LinkedIn post commenter captured by the Builder.LI extension. Creates a post_engagements row and returns its id for status polling.",
  schema: z.object({
    postUrl: z.string().url().describe("URL of the LinkedIn post"),
    postTitle: z.string().nullish().describe("First ~200 chars of the post text"),
    engagerName: z.string().describe("Commenter's name from the DOM"),
    engagerCompany: z.string().nullish().describe("Commenter's company from their headline"),
    engagerProfileUrl: z.string().url().describe("Commenter's LinkedIn /in/ URL"),
    commentText: z.string().nullish().describe("The commenter's comment text"),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();
    const ownerEmail = await resolveOwner(args.apiToken, ctx);

    // Reuse existing post name if we already have one for this URL; otherwise
    // generate once from the raw post text and reuse for all subsequent engagers.
    let postTitle: string | null = null;
    const existing = await db
      .select({ postTitle: postEngagements.postTitle })
      .from(postEngagements)
      .where(eq(postEngagements.postUrl, args.postUrl))
      .limit(1);

    if (existing[0]?.postTitle) {
      postTitle = existing[0].postTitle;
    } else if (args.postTitle && args.postTitle.trim().length > 10) {
      postTitle = await generatePostName(args.postTitle);
    }

    const id = nanoid();
    await db.insert(postEngagements).values({
      id,
      ownerEmail,
      postUrl: args.postUrl,
      postTitle,
      engagerName: args.engagerName,
      engagerCompany: args.engagerCompany ?? null,
      engagerProfileUrl: args.engagerProfileUrl,
      commentText: args.commentText ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, id, status: "pending" as const };
  },
});
