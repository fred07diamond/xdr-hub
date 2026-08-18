import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

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
  description: "Ingest a LinkedIn post commenter captured by the LinkedIn Agent extension. Creates a post_engagements row and returns its id for status polling.",
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

    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "ingest-post-engager", 60))) {
      return { ok: false, error: "Rate limit reached — try again shortly." };
    }

    // Check if this (postUrl, engagerProfileUrl, ownerEmail) combo already exists.
    const ownerFilter = ownerEmail
      ? eq(postEngagements.ownerEmail, ownerEmail)
      : isNull(postEngagements.ownerEmail);
    const existingEngager = await db
      .select()
      .from(postEngagements)
      .where(
        and(
          eq(postEngagements.postUrl, args.postUrl),
          eq(postEngagements.engagerProfileUrl, args.engagerProfileUrl),
          ownerFilter,
        ),
      )
      .limit(1);

    // Resolve post title: reuse from any existing row for this post URL, or generate once.
    let postTitle: string | null = existingEngager[0]?.postTitle ?? null;
    if (!postTitle) {
      const existingPost = await db
        .select({ postTitle: postEngagements.postTitle })
        .from(postEngagements)
        .where(and(eq(postEngagements.postUrl, args.postUrl), ownerFilter))
        .limit(1);
      postTitle = existingPost[0]?.postTitle ?? null;
    }
    if (!postTitle && args.postTitle && args.postTitle.trim().length > 10) {
      postTitle = await generatePostName(args.postTitle);
    }

    if (existingEngager[0]) {
      // Already exists — update metadata but preserve enriched data (status, fitVerdict, headline).
      const row = existingEngager[0];
      await db
        .update(postEngagements)
        .set({
          postTitle: postTitle ?? row.postTitle,
          engagerName: args.engagerName,
          engagerCompany: args.engagerCompany ?? row.engagerCompany,
          commentText: args.commentText ?? row.commentText,
          updatedAt: now,
        })
        .where(eq(postEngagements.id, row.id));
      return { ok: true, id: row.id, status: row.status };
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
