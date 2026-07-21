import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { buildMessagingContext } from "../server/helpers/build-messaging-context.js";
import { draftProfile } from "../server/helpers/draft-profile.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description:
    "Ingest a LinkedIn profile captured by the Builder.LI extension. Upserts the prospect row, scores fit, and drafts a connection note synchronously.",
  schema: z.object({
    profileUrl: z.string().url().describe("LinkedIn profile URL"),
    name: z.string().nullish(),
    headline: z.string().nullish(),
    role: z.string().nullish(),
    company: z.string().nullish(),
    about: z.string().nullish(),
    recentActivity: z.string().nullish(),
    apiToken: z.string().nullish().describe("Personal API token from the user's Settings page"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();

    const ownerEmail = await resolveOwner(args.apiToken, ctx);
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

    const { icpText, personaId, personaName, personaColor } = await selectPersona(db, profile);
    const profileSummary = buildProfileSummary(profile);
    const messagingContext = await buildMessagingContext(personaId, ownerEmail, db);

    const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
      icpText,
      profileSummary,
      messagingContext,
      profileUrl: args.profileUrl,
    });

    const draftedAt = new Date().toISOString();
    await db
      .update(prospects)
      .set({ fitVerdict, fitReason, draftNote, draftFollowUp, personaId, personaName, personaColor, status: "drafted", updatedAt: draftedAt })
      .where(eq(prospects.id, id));

    return { id, status: "drafted" as const, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
  },
});
