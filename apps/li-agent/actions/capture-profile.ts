import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases, prospects } from "../server/db/schema.js";
import { buildMessagingContext } from "../server/helpers/build-messaging-context.js";
import { buildCanvasContext } from "../server/helpers/build-canvas-context.js";
import { draftProfile } from "../server/helpers/draft-profile.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { isOverDailyLimit } from "../server/helpers/daily-limit.js";

export default defineAction({
  description:
    "Ingest a LinkedIn profile captured by the LinkedIn Agent extension. Upserts the prospect row, scores fit, and drafts a connection note synchronously.",
  schema: z.object({
    profileUrl: z.string().url().describe("LinkedIn profile URL"),
    name: z.string().nullish(),
    headline: z.string().nullish(),
    role: z.string().nullish(),
    company: z.string().nullish(),
    about: z.string().nullish(),
    recentActivity: z.string().nullish(),
    apiToken: z.string().nullish().describe("Personal API token from the user's Settings page"),
    canvasId: z.string().nullish().describe("Optional messaging canvas ID to use for context"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();

    const ownerEmail = await resolveOwner(args.apiToken, ctx);

    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "capture-profile", 60))) {
      return {
        id: "",
        status: "captured" as const,
        fitVerdict: "inconclusive" as const,
        fitReason: "Rate limit reached — try again shortly.",
        draftNote: "",
        draftFollowUp: null,
        personaName: null,
        personaColor: null,
      };
    }

    if (await isOverDailyLimit(ownerEmail)) {
      return {
        id: "",
        status: "captured" as const,
        fitVerdict: "inconclusive" as const,
        fitReason: "Daily outreach limit reached — resets tomorrow.",
        draftNote: "",
        draftFollowUp: null,
        personaName: null,
        personaColor: null,
      };
    }

    const ownerFilter = ownerEmail ? eq(prospects.ownerEmail, ownerEmail) : isNull(prospects.ownerEmail);

    // Upsert prospect row
    const existing = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.profileUrl, args.profileUrl), ownerFilter))
      .limit(1);

    const id = existing[0]?.id ?? nanoid();

    if (existing[0]) {
      await db
        .update(prospects)
        .set({
          name: args.name ?? null,
          headline: args.headline ?? null,
          role: args.role ?? null,
          company: args.company ?? null,
          about: args.about ?? null,
          recentActivity: args.recentActivity ?? null,
          status: "captured",
          updatedAt: now,
        })
        .where(eq(prospects.id, id));
    } else {
      await db.insert(prospects).values({
        id,
        ownerEmail,
        profileUrl: args.profileUrl,
        name: args.name ?? null,
        headline: args.headline ?? null,
        role: args.role ?? null,
        company: args.company ?? null,
        about: args.about ?? null,
        recentActivity: args.recentActivity ?? null,
        status: "captured",
        createdAt: now,
        updatedAt: now,
      });
    }

    const profile = {
      name: args.name,
      headline: args.headline,
      role: args.role,
      company: args.company,
      about: args.about,
      recentActivity: args.recentActivity,
      profileUrl: args.profileUrl,
    };

    // Verify the requested canvas belongs to the owner or is a system canvas.
    // Silently fall back to null rather than leaking that a canvas ID exists.
    if (args.canvasId) {
      const canvas = await db
        .select()
        .from(messagingCanvases)
        .where(eq(messagingCanvases.id, args.canvasId))
        .limit(1);
      const allowed =
        canvas.length > 0 &&
        (canvas[0].isSystem === 1 || canvas[0].ownerEmail === ownerEmail);
      if (!allowed) {
        args = { ...args, canvasId: undefined };
      }
    }

    const { icpText, personaId, personaName, personaColor } = await selectPersona(db, profile);
    const profileSummary = buildProfileSummary(profile);
    const canvasMessagingContext = args.canvasId
      ? await buildCanvasContext(args.canvasId, db)
      : null;
    const messagingContext =
      canvasMessagingContext ?? (await buildMessagingContext(personaId, ownerEmail, db));

    const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
      icpText,
      profileSummary,
      messagingContext,
      profileUrl: args.profileUrl,
      personaId,
      personaName,
    });

    const draftedAt = new Date().toISOString();
    await db
      .update(prospects)
      .set({ fitVerdict, fitReason, draftNote, draftFollowUp, personaId, personaName, personaColor, status: "drafted", updatedAt: draftedAt })
      .where(eq(prospects.id, id));

    return { id, status: "drafted" as const, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
  },
});
