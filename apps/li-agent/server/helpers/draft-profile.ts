import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOutreachVoiceGuidelines } from "@xdr-hub/shared/server";
import { getOwnerCtx } from "./get-owner-ctx.js";
import { getPersonaGrounding, unauthorizedCustomerMentioned } from "./sales-library.js";
import { NO_EM_DASH_RULE, stripEmDashes } from "./style-rules.js";

export interface DraftResult {
  fitVerdict: "strong" | "possible" | "weak" | "inconclusive";
  fitReason: string;
  draftNote: string;
  draftFollowUp: string | null;
  unauthorizedCustomerMention: string | null;
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
        "Scoring rubric — be decisive, don't hedge:\n" +
        "- strong: title + seniority match the ICP, OR clear behavioral signals (sharing/praising tools, vendors, or themes in the space — even a single specific post counts). If evidence points to strong, score it strong.\n" +
        "- possible: genuine uncertainty only — title is adjacent OR seniority is one level off, AND no behavioral signals exist.\n" +
        "- weak: clear mismatch — wrong function, clearly too junior, or explicit counter-evidence.\n\n" +
        "Behavioral signals in recent activity outweigh a generic About. A post engaging with a specific tool, person, or theme in the space is stronger evidence than years of experience. Score up when signals exist.\n\n" +
        'Reply with valid JSON only: { "fitVerdict": "strong"|"possible"|"weak", "fitReason": "<one sentence citing the strongest specific evidence — lead with behavioral signals if present>", ' +
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
        maxOutputTokens: 700,
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
      parsed = {
        fitVerdict: g(/"fitVerdict"\s*:\s*"(strong|possible|weak|inconclusive)"/i),
        fitReason: g(/"fitReason"\s*:\s*"([^"\\]*)"/),
        draftNote: g(/"draftNote"\s*:\s*"([^"\\]*)"/),
        draftFollowUp: g(/"draftFollowUp"\s*:\s*"([^"\\]*)"/),
      };
      if (!parsed.fitVerdict && !parsed.draftNote) throw new Error("Unparseable model response");
    }

    const v = String(parsed.fitVerdict ?? "");
    if (v === "strong" || v === "possible" || v === "weak" || v === "inconclusive") fitVerdict = v;
    if (parsed.fitReason) fitReason = stripEmDashes(String(parsed.fitReason));
    if (parsed.draftNote) draftNote = stripEmDashes(String(parsed.draftNote).slice(0, 300));
    if (parsed.draftFollowUp) draftFollowUp = stripEmDashes(String(parsed.draftFollowUp).slice(0, 150));

    unauthorizedCustomerMention = unauthorizedCustomerMentioned(`${draftNote} ${draftFollowUp ?? ""}`, otherCustomerNames);
  } catch (err) {
    fitReason = `Draft failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { fitVerdict, fitReason, draftNote, draftFollowUp, unauthorizedCustomerMention };
}
