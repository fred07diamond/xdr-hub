// apps/outreach/server/helpers/score-engager.ts
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOwnerCtx } from "./get-owner-ctx.js";

export interface EngagerScoreResult {
  fitVerdict: "strong" | "possible" | "weak" | "inconclusive";
  fitReason: string;
}

export async function scoreEngager({
  icpText,
  profileSummary,
  commentText,
}: {
  icpText: string | null;
  profileSummary: string;
  commentText: string | null;
}): Promise<EngagerScoreResult> {
  let fitVerdict: EngagerScoreResult["fitVerdict"] = "inconclusive";
  let fitReason = "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring.";

  try {
    const ownerCtx = await getOwnerCtx();
    const commentBlock = commentText
      ? `\nThey commented on the post: "${commentText.slice(0, 300)}"\n`
      : "";

    const systemPrompt = icpText
      ? "You are a LinkedIn outreach assistant. Score fit for a prospect who engaged with a LinkedIn post.\n\n" +
        `ICP document:\n${icpText.slice(0, 3000)}\n\n` +
        commentBlock +
        "Scoring rubric — be decisive, don't hedge:\n" +
        "- strong: title + seniority match the ICP, OR the comment text shows clear intent/interest relevant to the ICP space.\n" +
        "- possible: genuine uncertainty only — title is adjacent OR seniority is one level off, AND no behavioral signals.\n" +
        "- weak: clear mismatch — wrong function, clearly too junior, or explicit counter-evidence.\n\n" +
        "A substantive comment about the topic outweighs a generic profile. Score up when signals exist.\n\n" +
        'Reply with valid JSON only: { "fitVerdict": "strong"|"possible"|"weak", "fitReason": "<one sentence citing the strongest specific evidence>" }'
      : 'Reply with valid JSON only: { "fitVerdict": "inconclusive", "fitReason": "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring." }';

    const input = profileSummary || "Unknown profile";
    const callCompleteText = () =>
      completeText({ systemPrompt, input, maxOutputTokens: 300 });

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
      };
      if (!parsed.fitVerdict) throw new Error("Unparseable model response");
    }

    const v = String(parsed.fitVerdict ?? "");
    if (v === "strong" || v === "possible" || v === "weak" || v === "inconclusive") {
      fitVerdict = v;
    }
    if (parsed.fitReason) fitReason = String(parsed.fitReason);
  } catch (err) {
    fitReason = `Scoring failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return { fitVerdict, fitReason };
}
