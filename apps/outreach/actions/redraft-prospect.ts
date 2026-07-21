import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { buildMessagingContext } from "../server/helpers/build-messaging-context.js";
import { draftProfile } from "../server/helpers/draft-profile.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";

export default defineAction({
  description: "Re-run AI scoring and note drafting for an existing prospect without recapturing the profile.",
  schema: z.object({
    id: z.string().min(1),
  }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Authentication required");

    const rows = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, id), eq(prospects.ownerEmail, userEmail)))
      .limit(1);

    if (!rows[0]) throw new Error("Prospect not found");
    const prospect = rows[0];

    const profile = {
      name: prospect.name,
      headline: prospect.headline,
      role: prospect.role,
      company: prospect.company,
      about: prospect.about,
      recentActivity: prospect.recentActivity,
      profileUrl: prospect.profileUrl,
    };

    const { icpText, personaId, personaName, personaColor } = await selectPersona(db, profile);
    const profileSummary = buildProfileSummary(profile);
    const messagingContext = await buildMessagingContext(personaId, userEmail, db);

    const { fitVerdict, fitReason, draftNote, draftFollowUp } = await draftProfile({
      icpText,
      profileSummary,
      messagingContext,
      profileUrl: prospect.profileUrl,
    });

    await db
      .update(prospects)
      .set({ fitVerdict, fitReason, draftNote, draftFollowUp, personaId, personaName, personaColor, status: "drafted", updatedAt: new Date().toISOString() })
      .where(eq(prospects.id, id));

    return { ok: true, draft: { fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor } };
  },
});
