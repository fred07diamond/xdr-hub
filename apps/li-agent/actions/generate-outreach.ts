import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { leadLists, leadListItems, outreachDrafts, prospects } from "../server/db/schema.js";
import { generateOutreach } from "../server/helpers/generate-outreach.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";
import { buildProfileSummary, selectPersona } from "../server/helpers/select-persona.js";

/**
 * Generates outreach for one lead and stores it.
 *
 * Gated on the FIT SCORE rather than offered everywhere, because that is the
 * whole point of the feature: these are the extra tools a lead earns by being
 * worth the effort. Generating three InMail variants for every row in a
 * 7,000-lead list is LLM spend with no judgment behind it.
 *
 * The gate is a floor, not the hot-lead threshold. A hot lead is
 * score + corroborating signal; this only asks that somebody has established
 * the lead is worth writing to at all, so a strong-but-not-hot lead can still
 * get an email if the rep decides to chase it.
 */
const MIN_SCORE_TO_GENERATE = 40;

export default defineAction({
  description:
    "Generate outreach for a high-scoring lead: a cold email, a LinkedIn InMail, connection-note variants, or a cold-call opener. Stores the result so it can be reviewed and reused.",
  schema: z.object({
    source: z.enum(["lead_list_item", "prospect"]),
    id: z.string().min(1),
    kind: z.enum(["email", "inmail", "note", "call_opener"]),
    // Only the note generator uses more than one; capped at 3 because a
    // fourth angle is a reword of one of the first three.
    variants: z.number().int().min(1).max(3).default(1),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  audit: {
    target: (args) => ({ type: args.source, id: args.id }),
    summary: (args) => `Generated ${args.kind} outreach`,
  },
  run: async ({ source, id, kind, variants }, ctx) => {
    const ownerEmail = ctx?.userEmail ?? null;
    const db = getDb();

    // Same bucket the other LLM paths use. Generation is not billed to Apollo,
    // but it is not free either, and three variants is three times the work.
    if (!(await checkRateLimit(ownerEmail ?? "anonymous", "generate-outreach", 200))) {
      return { ok: false as const, code: "rate_limited", error: "Too many generations just now. Try again shortly." };
    }

    const subjectTable = source === "prospect" ? "prospects" : "lead_list_items";

    // Load the lead, scoped to its owner. Two shapes, one read each, rather
    // than a union type that would need narrowing at every use.
    const row =
      source === "prospect"
        ? (
            await db
              .select()
              .from(prospects)
              .where(
                and(
                  eq(prospects.id, id),
                  // Scoped to the owner, with isNull for the anonymous case --
                  // the same spelling the other prospect actions use.
                  ownerEmail ? eq(prospects.ownerEmail, ownerEmail) : isNull(prospects.ownerEmail),
                ),
              )
              .limit(1)
          )[0]
        : (
            await db
              .select()
              .from(leadListItems)
              .innerJoin(leadLists, eq(leadListItems.listId, leadLists.id))
              .where(
                and(
                  eq(leadListItems.id, id),
                  // Ownership lives on lead_lists, not on the item. Without
                  // this join any signed-in user could generate outreach
                  // against someone else's lead.
                  ownerEmail ? eq(leadLists.ownerEmail, ownerEmail) : isNull(leadLists.ownerEmail),
                ),
              )
              .limit(1)
          ).map((r) => r.lead_list_items)[0];

    if (!row) return { ok: false as const, code: "not_found", error: "Lead not found." };

    if ((row.fitScore ?? 0) < MIN_SCORE_TO_GENERATE) {
      return {
        ok: false as const,
        code: "score_too_low",
        error:
          row.fitScore == null
            ? "Score this lead first. Outreach is generated from the fit assessment, so an unscored lead has nothing to personalize against."
            : `This lead scored ${row.fitScore}. Outreach generation is for leads scoring ${MIN_SCORE_TO_GENERATE} or above.`,
      };
    }

    const profile = {
      name: row.name ?? "",
      // ProfileData requires it. Empty string rather than null for a lead-list
      // row that has no resolved public URL yet -- selectPersona and
      // buildProfileSummary both tolerate it, and it is the same shape
      // score-lead-list-item already passes.
      profileUrl: row.profileUrl ?? "",
      headline: row.enrichedTitle ?? row.headline ?? null,
      role: null,
      company: row.company ?? null,
      about: "about" in row ? ((row as { about?: string | null }).about ?? null) : null,
      recentActivity:
        "recentActivity" in row ? ((row as { recentActivity?: string | null }).recentActivity ?? null) : null,
    };

    // Re-resolves the persona so its ICP text and Sales Library grounding come
    // from the CURRENT criteria, not whatever was cached on the row when it
    // was first scored.
    const { icpText, personaId, personaName } = await selectPersona(db, profile);

    const result = await generateOutreach({
      kind,
      profileSummary: buildProfileSummary(profile),
      icpText,
      personaId,
      personaName,
      intentSignal: row.intentSignal ?? null,
      fitReason: row.fitReason ?? null,
      variants: kind === "note" ? variants : 1,
    });

    if (result.error || result.drafts.length === 0) {
      return { ok: false as const, code: "generation_failed", error: result.error ?? "Nothing was generated." };
    }

    const now = new Date().toISOString();
    const saved = result.drafts.map((d, index) => ({
      id: nanoid(),
      ownerEmail,
      subjectTable: subjectTable as "prospects" | "lead_list_items",
      subjectId: id,
      kind: d.kind,
      subject: d.subject,
      body: d.body,
      angle: d.angle,
      variantIndex: index,
      // Stamped so a draft written against a score of 92 is still identifiable
      // after a rescore moves the lead to 61. Otherwise old drafts silently
      // look like they were generated under the current assessment.
      fitScoreAtGeneration: row.fitScore ?? null,
      createdAt: now,
    }));

    // Replace the previous set for this lead+kind. Keeping every historical
    // generation would turn the panel into an archive nobody reads, and the
    // reason to regenerate is almost always that the last attempt was wrong.
    await db
      .delete(outreachDrafts)
      .where(
        and(
          eq(outreachDrafts.subjectTable, subjectTable as "prospects" | "lead_list_items"),
          eq(outreachDrafts.subjectId, id),
          eq(outreachDrafts.kind, kind),
        ),
      );
    await db.insert(outreachDrafts).values(saved);

    return {
      ok: true as const,
      drafts: saved.map((s) => ({
        id: s.id,
        kind: s.kind,
        subject: s.subject,
        body: s.body,
        angle: s.angle,
        variantIndex: s.variantIndex,
      })),
      // Surfaced, not swallowed: the same check draft-profile applies. A
      // generated message naming an unapproved customer is the rep's problem
      // to see before sending, not something to quietly strip.
      unauthorizedCustomerMention: result.unauthorizedCustomerMention,
    };
  },
});
