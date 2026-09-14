import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOutreachVoiceGuidelines } from "@xdr-hub/shared/server";
import { getOwnerCtx } from "./get-owner-ctx.js";
import { getPersonaGrounding, unauthorizedCustomerMentioned } from "./sales-library.js";
import {
  clampDimension,
  SCORE_JSON_CONTRACT,
  SCORING_RUBRIC,
  totalScore,
  verdictForScore,
  type FitBreakdown,
  type FitVerdict,
} from "./fit-score.js";
import { NO_EM_DASH_RULE, stripEmDashes } from "./style-rules.js";

export interface DraftResult {
  /**
   * DERIVED from fitScore, not asked of the model directly.
   *
   * Keeping this field means every existing consumer -- the credit guard's
   * verdictClearsBar gates, the Prospects filter pills, Analytics counts,
   * badges, leadQuality -- keeps working with no migration. See fit-score.ts.
   */
  fitVerdict: FitVerdict;
  fitReason: string;
  draftNote: string;
  draftFollowUp: string | null;
  unauthorizedCustomerMention: string | null;
  /** 0-100. Null when no ICP document exists, so fit was never assessed. */
  fitScore: number | null;
  /** Per-dimension scores. Null for the same reason. */
  fitBreakdown: FitBreakdown | null;
  /** The one specific recent signal Intent was scored on, if any. */
  intentSignal: string | null;
}

export async function draftProfile({
  icpText,
  profileSummary,
  messagingContext,
  profileUrl,
  personaId,
  personaName,
}: {
  icpText: string | null;
  profileSummary: string;
  messagingContext?: string | null;
  profileUrl: string;
  personaId?: string | null;
  personaName?: string | null;
}): Promise<DraftResult> {
  let fitVerdict: DraftResult["fitVerdict"] = "inconclusive";
  let fitReason = "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring.";
  let draftNote = "";
  let draftFollowUp: string | null = null;
  let unauthorizedCustomerMention: string | null = null;
  let fitScore: number | null = null;
  let fitBreakdown: FitBreakdown | null = null;
  let intentSignal: string | null = null;

  try {
    const ownerCtx = await getOwnerCtx();
    const messagingBlock = messagingContext ? `\n${messagingContext}\n\n` : "";
    // Shared workspace-wide voice/tone guidelines (also used by Prospecting
    // Hub's own email/LinkedIn drafting) — see outreach-voice.ts. Keeps
    // messaging consistent across apps without merging either app's own
    // grounding data or generation logic.
    const voiceGuidelines = await getOutreachVoiceGuidelines(ownerCtx?.userEmail ?? "", ownerCtx?.orgId ?? null);
    const voiceBlock = `Voice and tone guidelines:\n${voiceGuidelines}\n\n`;

    // Persona-linked Sales Library docs -- a new grounding input alongside
    // the ICP document and messaging context, same lookup prospecting-hub's
    // own drafting already uses (see sales-library.ts's own comment).
    const { groundingBlock, customerEvidenceBlock, otherCustomerNames } = await getPersonaGrounding(
      personaId ?? null,
      personaName ?? null,
    );
    const salesLibraryBlock = `Persona-specific messaging reference:\n${groundingBlock}\n\n${customerEvidenceBlock ? `${customerEvidenceBlock}\n\n` : ""}`;

    const systemPrompt = icpText
      ? "You are a LinkedIn outreach assistant. Score fit and draft a personalized connection note.\n\n" +
        `${NO_EM_DASH_RULE}\n\n` +
        `ICP document:\n${icpText.slice(0, 3000)}\n\n` +
        messagingBlock +
        voiceBlock +
        salesLibraryBlock +
        `${SCORING_RUBRIC}\n\n` +
        // No fitVerdict is requested. It is derived from the score, so the
        // model cannot hand back a label that disagrees with its own numbers.
        'Reply with valid JSON only: { ' +
        SCORE_JSON_CONTRACT +
        '"fitReason": "<one sentence citing the strongest specific evidence, leading with the recent signal if there is one>", ' +
        '"draftNote": "<connection note, max 200 chars, genuine and specific — if recent activity is available, reference it>", ' +
        '"draftFollowUp": "<follow-up to send after they accept, max 100 chars>" }'
      : "You are a LinkedIn outreach assistant. No ICP document has been uploaded, so you cannot score fit.\n\n" +
        `${NO_EM_DASH_RULE}\n\n` +
        messagingBlock +
        voiceBlock +
        'Reply with valid JSON only: { "fitVerdict": "inconclusive", "fitReason": "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring.", ' +
        '"draftNote": "<a brief, generic, professional connection note based only on the profile, max 200 chars — do not reference any ICP or scoring criteria>", ' +
        '"draftFollowUp": "<a short generic follow-up, max 100 chars>" }';

    const callCompleteText = () =>
      completeText({
        systemPrompt,
        input: profileSummary || `LinkedIn profile: ${profileUrl}`,
        // Raised from 700. The response GREW when granular scoring landed --
        // it now carries a four-number score object and an intentSignal on top
        // of the reason, note and follow-up -- and I did not raise the cap with
        // it, so the answer could be truncated even with reasoning off.
        maxOutputTokens: 1200,
        /**
         * Reasoning OFF, same as the briefing phases, and for the same reason.
         *
         * completeText with no effort takes the engine default, which resolves
         * to Medium or High. Against a 700-token cap that is a guaranteed
         * starvation: Anthropic's manual thinking budgets start at 1024 and
         * reach 8000 for medium, so thinking alone could consume the whole
         * allowance and return an empty draft with stopReason max_tokens --
         * which surfaces here as "Draft failed" or a silently unscored lead.
         *
         * This call scores four numbered dimensions against a supplied rubric
         * and writes a 200-character note. It is extraction and short-form
         * writing, not reasoning.
         */
        reasoningEffort: "none",
      });
    const result = ownerCtx
      ? await runWithRequestContext(ownerCtx, callCompleteText)
      : await callCompleteText();

    const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const g = (re: RegExp) => re.exec(raw)?.[1]?.trim() ?? null;
      const num = (key: string) => {
        const m = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(raw);
        return m ? Number.parseInt(m[1], 10) : null;
      };
      parsed = {
        // Salvage the dimensions individually. A truncated or lightly
        // malformed response usually still contains the numbers, and losing
        // the score to a stray character would silently drop the lead back to
        // unscored.
        score: {
          roleFit: num("roleFit"),
          seniority: num("seniority"),
          companyFit: num("companyFit"),
          intent: num("intent"),
        },
        intentSignal: g(/"intentSignal"\s*:\s*"([^"\\]*)"/),
        fitReason: g(/"fitReason"\s*:\s*"([^"\\]*)"/),
        draftNote: g(/"draftNote"\s*:\s*"([^"\\]*)"/),
        draftFollowUp: g(/"draftFollowUp"\s*:\s*"([^"\\]*)"/),
      };
      if (!parsed.draftNote && !(parsed.score as Record<string, unknown>)?.roleFit) {
        throw new Error("Unparseable model response");
      }
    }

    // Score first, then derive the verdict from it.
    if (icpText) {
      const raw = (parsed.score ?? {}) as Record<string, unknown>;
      const breakdown: FitBreakdown = {
        roleFit: clampDimension(raw.roleFit, "roleFit"),
        companyFit: clampDimension(raw.companyFit, "companyFit"),
        intent: clampDimension(raw.intent, "intent"),
        seniority: clampDimension(raw.seniority, "seniority"),
      };
      fitBreakdown = breakdown;
      fitScore = totalScore(breakdown);
      fitVerdict = verdictForScore(fitScore, true);
      if (parsed.intentSignal) {
        const sig = stripEmDashes(String(parsed.intentSignal)).slice(0, 200).trim();
        // The model returns the string "null" often enough to be worth
        // handling; storing it would render as a signal that does not exist.
        intentSignal = sig && sig.toLowerCase() !== "null" && sig !== "-" ? sig : null;
      }
    }
    if (parsed.fitReason) fitReason = stripEmDashes(String(parsed.fitReason));
    if (parsed.draftNote) draftNote = stripEmDashes(String(parsed.draftNote).slice(0, 300));
    if (parsed.draftFollowUp) draftFollowUp = stripEmDashes(String(parsed.draftFollowUp).slice(0, 150));

    unauthorizedCustomerMention = unauthorizedCustomerMentioned(`${draftNote} ${draftFollowUp ?? ""}`, otherCustomerNames);
  } catch (err) {
    fitReason = `Draft failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return {
    fitVerdict,
    fitReason,
    draftNote,
    draftFollowUp,
    unauthorizedCustomerMention,
    fitScore,
    fitBreakdown,
    intentSignal,
  };
}
