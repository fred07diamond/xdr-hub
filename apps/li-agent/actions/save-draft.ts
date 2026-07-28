import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";

export default defineAction({
  description:
    "Write the agent's fit score and drafted note back to the prospect row and set status to 'drafted'. Called by the agent after running the profile-draft skill — not exposed to the extension.",
  schema: z.object({
    profileUrl: z.string().describe("LinkedIn profile URL"),
    fitVerdict: z.enum(["strong", "possible", "weak"]),
    fitReason: z.string().describe("One-line reasoning for the verdict"),
    draftNote: z.string().describe("Drafted connection note (≤300 chars)"),
    draftFollowUp: z
      .string()
      .optional()
      .describe("Optional short follow-up for after they accept"),
  }),
  run: async ({ profileUrl, fitVerdict, fitReason, draftNote, draftFollowUp }) => {
    const db = getDb();
    const now = new Date().toISOString();

    await db
      .update(prospects)
      .set({
        fitVerdict,
        fitReason,
        draftNote,
        draftFollowUp: draftFollowUp ?? null,
        status: "drafted",
        updatedAt: now,
      })
      .where(eq(prospects.profileUrl, profileUrl));

    return { ok: true };
  },
});
