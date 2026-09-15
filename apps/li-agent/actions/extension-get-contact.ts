import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { enrichApolloRecord } from "../server/helpers/enrich-apollo-record.js";
import { resolveOwnerStrict } from "../server/helpers/resolve-owner.js";
import { REVEAL_CREDITS, revealPhoneForRecord } from "../server/helpers/reveal-phone-for-record.js";

/**
 * Contact details for the LinkedIn profile the extension is looking at.
 *
 * For the case the dashboard is bad at: you are on someone's profile, you want
 * to call them now, and opening the app to find the same person and click two
 * buttons is friction that makes people skip the tool.
 *
 * It is NOT a side door around the credit system, and that is the main design
 * constraint. Both legs go through exactly the paths the dashboard uses:
 * `enrichApolloRecord` for the email (whose branded CreditAuthorization makes
 * bypassing the guard a compile error) and `revealPhoneForRecord` for the
 * phone (the shared gates, extracted for this). So the per-user cap, the
 * workspace budget, the 80% phone pause, the fit bar and the ledger
 * attribution all apply identically whether a reveal is triggered from the
 * extension or the app.
 *
 * `confirmCredits` still has to be echoed for the phone, for the same reason
 * the dashboard requires it: a stale extension cannot spend 8 credits by
 * accident, and the price is part of the request rather than a number the UI
 * hopes it displayed.
 */
export default defineAction({
  description:
    "Fetch a LinkedIn profile's email and, on explicit request, phone number for the Chrome extension. Email costs 1 Apollo credit, a phone reveal costs 8 and is fit-gated. Subject to the same workspace and per-user credit limits as the dashboard.",
  schema: z.object({
    profileUrl: z.string().min(1).describe("The linkedin.com/in/... URL currently open"),
    /** Email is the cheap default: 1 credit, no fit gate. */
    wantEmail: z.boolean().default(true),
    /** Phone is opt-in per call. 8 credits, fit-gated. */
    wantPhone: z.boolean().default(false),
    /** Required when wantPhone is true. Must equal the real cost. */
    confirmCredits: z.literal(REVEAL_CREDITS).nullish(),
    /** Knowingly spending 8 credits on a lead below the fit bar. */
    override: z.boolean().default(false),
    apiToken: z.string().nullish().describe("Personal API token from Settings"),
  }),
  requiresAuth: false,
  // NO `http` block, deliberately.
  //
  // Declaring `http: { method: "POST" }` was why this returned a bare
  // {"error":"Unauthorized"} and the extension buttons did nothing: an
  // explicit http block creates a direct HTTP route whose auth is separate
  // from the publicAgent path, so the request was rejected by the framework
  // before `run` ever executed -- which is why my own "add your API token"
  // message never appeared.
  //
  // capture-profile, import-sales-nav-list and ingest-post-engager are all
  // POSTed by the extension and all omit it. Matching them.
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  audit: {
    target: (args) => ({ type: "prospect", id: args.profileUrl }),
    summary: (args) =>
      args.wantPhone
        ? `Extension phone reveal (${REVEAL_CREDITS} credits)${args.override ? " — OVERRIDE below the fit bar" : ""}`
        : "Extension email lookup (1 credit)",
  },
  run: async ({ profileUrl, wantEmail, wantPhone, confirmCredits, override, apiToken }, ctx) => {
    const actorEmail = await resolveOwnerStrict(apiToken, ctx);
    if (!actorEmail) {
      return {
        ok: false as const,
        code: "unauthorized",
        error: "Add your API token in the extension options first.",
      };
    }

    // Echoed cost is checked HERE rather than by the schema alone, because
    // `confirmCredits` is optional for an email-only call and a literal cannot
    // express "required only when wantPhone".
    if (wantPhone && confirmCredits !== REVEAL_CREDITS) {
      return {
        ok: false as const,
        code: "cost_not_confirmed",
        error: `A phone reveal costs ${REVEAL_CREDITS} credits and the client must confirm that cost.`,
      };
    }

    const db = getDb();
    const [row] = await db
      .select()
      .from(prospects)
      .where(
        and(
          eq(prospects.profileUrl, profileUrl),
          // Ownership: a lookup spends shared credits, so it must not be
          // possible to trigger one against someone else's prospect.
          eq(prospects.ownerEmail, actorEmail),
        ),
      )
      .limit(1);

    if (!row) {
      // capture-profile runs when the panel opens a profile, so this normally
      // cannot happen. Saying what to do beats a bare "not found".
      return {
        ok: false as const,
        code: "not_captured",
        error: "This profile has not been captured yet. Open the panel on the profile and let it load first.",
      };
    }

    const result: {
      ok: true;
      email: string | null;
      phone: string | null;
      phoneRevealStatus: string | null;
      creditsCharged: number;
      emailError: string | null;
      phoneError: string | null;
      phoneErrorCode: string | null;
      fitVerdict: string | null;
      fitReason: string | null;
      canOverride: boolean;
    } = {
      ok: true,
      email: row.enrichedEmail ?? null,
      phone: row.enrichedPhone ?? null,
      phoneRevealStatus: row.phoneRevealStatus ?? null,
      creditsCharged: 0,
      emailError: null,
      phoneError: null,
      phoneErrorCode: null,
      fitVerdict: row.fitVerdict ?? null,
      fitReason: row.fitReason ?? null,
      canOverride: false,
    };

    // ── Email: 1 credit, and skipped entirely if we already have one ────────
    if (wantEmail && !row.enrichedEmail) {
      const enriched = await enrichApolloRecord(
        db,
        { kind: "prospect", row },
        { trigger: "manual", actorEmail, revealPhone: false },
      );
      if (enriched.blockedReason) {
        result.emailError = enriched.blockedMessage ?? "Enrichment was blocked.";
      } else {
        result.email = enriched.enrichedEmail ?? null;
        result.creditsCharged += 1;
        if (!result.email) {
          result.emailError = "Apollo has no email on file for this person.";
        }
      }
    }

    // ── Phone: 8 credits, fit-gated, opt-in ────────────────────────────────
    if (wantPhone) {
      // Re-read: the email enrichment above may have populated a phone
      // synchronously, in which case the reveal is unnecessary and its 8
      // credits are never spent.
      const [fresh] = await db.select().from(prospects).where(eq(prospects.id, row.id)).limit(1);
      const current = fresh ?? row;

      if (current.enrichedPhone) {
        result.phone = current.enrichedPhone;
      } else {
        const reveal = await revealPhoneForRecord({
          row: current,
          source: "prospect",
          actorEmail,
          override,
          trigger: "manual",
        });
        if (reveal.ok) {
          result.phone = reveal.enrichedPhone;
          result.phoneRevealStatus = reveal.phoneRevealStatus;
          result.creditsCharged += reveal.creditsCharged;
        } else {
          result.phoneError = reveal.error;
          result.phoneErrorCode = reveal.code;
          // Only the fit gate is overridable. The budget tier is policy, and
          // offering an override for it would be a lie.
          result.canOverride = reveal.code === "fit_gate";
          if (reveal.fitVerdict !== undefined) result.fitVerdict = reveal.fitVerdict ?? null;
          if (reveal.fitReason !== undefined) result.fitReason = reveal.fitReason ?? null;
        }
      }
    }

    return result;
  },
});
