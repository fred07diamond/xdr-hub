import { defineAction } from "@agent-native/core";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { postEngagements } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "Ingest a LinkedIn post commenter captured by the Builder.LI extension. Creates a post_engagements row and returns its id for status polling.",
  schema: z.object({
    postUrl: z.string().url().describe("URL of the LinkedIn post"),
    postTitle: z.string().nullish().describe("First ~80 chars of the post text"),
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

    const id = nanoid();
    await db.insert(postEngagements).values({
      id,
      ownerEmail,
      postUrl: args.postUrl,
      postTitle: args.postTitle ?? null,
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
