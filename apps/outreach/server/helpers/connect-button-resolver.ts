import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOwnerCtx } from "./get-owner-ctx.js";

export interface ConnectCandidate {
  index: number;
  tag: string;
  text: string;
  ariaLabel: string | null;
  contextText: string;
}

export async function resolveConnectButtonIndex(
  profileName: string,
  candidates: ConnectCandidate[],
): Promise<{ ok: true; index: number } | { ok: false; error: string }> {
  if (candidates.length === 0) return { ok: false, error: "No candidates provided." };
  if (candidates.length === 1) return { ok: true, index: 0 };

  const ownerCtx = await getOwnerCtx();

  const candidateList = candidates
    .map((c) => `${c.index}: tag=${c.tag} ariaLabel="${c.ariaLabel ?? ""}" surroundingText="${c.contextText}"`)
    .join("\n");

  const call = () =>
    completeText({
      systemPrompt:
        "You are given a list of interactive Connect elements found on a LinkedIn profile page and the name of the person whose profile is being viewed. " +
        "Some elements belong to the main profile card (correct). Others belong to sidebar recommendations (wrong). " +
        "Reply with ONLY the integer index of the main profile Connect button.",
      input: `Profile being viewed: ${profileName}\n\nCandidates:\n${candidateList}\n\nWhich index is the Connect button for ${profileName}?`,
      maxOutputTokens: 5,
    });

  let result;
  try {
    result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const index = parseInt(result.text.trim(), 10);
  if (isNaN(index) || index < 0 || index >= candidates.length) {
    return { ok: false, error: `Agent returned unexpected value: "${result.text.trim()}"` };
  }

  return { ok: true, index };
}
