import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOutreachVoiceGuidelines } from "@xdr-hub/shared/server";

import { getOwnerCtx } from "./get-owner-ctx.js";
import { getPersonaGrounding, unauthorizedCustomerMentioned } from "./sales-library.js";
import { NO_EM_DASH_RULE, stripEmDashes } from "./style-rules.js";

/**
 * Outreach generators for high-scoring leads.
 *
 * Follows draft-profile.ts exactly rather than inventing a second generation
 * path: same owner context, same shared voice guidelines, same persona
 * grounding from the Sales Library, same em-dash rule and output sanitizer,
 * same unauthorized-customer check. Four channels with genuinely different
 * constraints, not one prompt with the channel named in it.
 *
 * Each generator gets a hard length ceiling because the channels have real
 * limits, and a model asked for "an email" writes six paragraphs.
 */

export type OutreachKind = "email" | "inmail" | "note" | "call_opener";

export interface OutreachDraft {
  kind: OutreachKind;
  subject: string | null;
  body: string;
  /** The specific angle taken, so three variants are distinguishable. */
  angle: string | null;
}

export interface GenerateOutreachInput {
  kind: OutreachKind;
  profileSummary: string;
  icpText: string | null;
  personaId?: string | null;
  personaName?: string | null;
  /** The recent signal the score was based on, if any. The best opener. */
  intentSignal?: string | null;
  fitReason?: string | null;
  /** How many variants to produce. Only the note generator uses more than 1. */
  variants?: number;
}

export interface GenerateOutreachResult {
  drafts: OutreachDraft[];
  error: string | null;
  unauthorizedCustomerMention: string | null;
}

/** Per-channel limits and instructions. */
const CHANNEL_SPECS: Record<
  OutreachKind,
  { label: string; maxBody: number; hasSubject: boolean; rules: string[] }
> = {
  email: {
    label: "cold email",
    maxBody: 900,
    hasSubject: true,
    rules: [
      "Under 120 words in the body. A cold email that needs scrolling does not get read.",
      "Subject under 50 characters, lowercase, no colon-separated marketing construction.",
      "Open on THEM. Never open with who you are or what you sell.",
      "One ask, and make it small: a reply, not a meeting.",
      "No bullet lists, no bold, no links. It must read as typed by a person.",
    ],
  },
  inmail: {
    label: "LinkedIn InMail",
    maxBody: 1200,
    hasSubject: true,
    rules: [
      "Under 150 words. InMail allows more room than a connection note, and using all of it is still a mistake.",
      "Subject under 60 characters.",
      "They can see your profile, so do not introduce yourself at length.",
      "Reference something specific and verifiable from their profile or activity.",
      "End with a question they can answer in one line.",
    ],
  },
  note: {
    label: "LinkedIn connection note",
    // 300 for Premium/Sales Navigator, per the app's documented rule; the
    // prompt aims lower so a free account is not silently truncated.
    maxBody: 300,
    hasSubject: false,
    rules: [
      "Maximum 280 characters. LinkedIn hard-caps a connection note at 300 on Premium and around 200 on a free account.",
      "No pitch. The only goal is that they accept.",
      "One specific, true detail from the profile. If there is nothing specific, be short and plain rather than inventing warmth.",
    ],
  },
  call_opener: {
    label: "cold call opener",
    maxBody: 600,
    hasSubject: false,
    rules: [
      "Under 60 words, written to be SPOKEN. Contractions, short clauses.",
      "Name the reason for the call in the first sentence.",
      "Include a permission line so they can say no quickly.",
      "No value-proposition monologue. This is the first fifteen seconds only.",
    ],
  },
};

const VARIANT_ANGLES = [
  "their recent activity or a specific signal",
  "the problem their role owns",
  "something specific and factual about their company",
];

export async function generateOutreach(
  input: GenerateOutreachInput,
): Promise<GenerateOutreachResult> {
  const spec = CHANNEL_SPECS[input.kind];
  const variants = Math.max(1, Math.min(3, input.variants ?? 1));

  try {
    const ownerCtx = await getOwnerCtx();
    const voiceGuidelines = await getOutreachVoiceGuidelines(
      ownerCtx?.userEmail ?? "",
      ownerCtx?.orgId ?? null,
    );
    const { groundingBlock, customerEvidenceBlock, otherCustomerNames } = await getPersonaGrounding(
      input.personaId ?? null,
      input.personaName ?? null,
    );

    // The signal goes in ABOVE the ICP and the grounding, because it is the
    // single most useful input for a reply and burying it mid-prompt is how it
    // gets ignored.
    const signalBlock = input.intentSignal
      ? `The strongest recent signal about this person, and the best thing to open on:\n${input.intentSignal}\n\n`
      : "No recent activity signal is available. Do NOT invent one. Personalize only from the profile below.\n\n";

    const systemPrompt =
      `You are writing a ${spec.label} for a B2B sales rep.\n\n` +
      `${NO_EM_DASH_RULE}\n\n` +
      signalBlock +
      (input.icpText ? `ICP document (who we sell to):\n${input.icpText.slice(0, 2500)}\n\n` : "") +
      (input.fitReason ? `Why this lead was scored highly:\n${input.fitReason}\n\n` : "") +
      `Voice and tone guidelines:\n${voiceGuidelines}\n\n` +
      `Persona-specific messaging reference:\n${groundingBlock}\n\n` +
      (customerEvidenceBlock ? `${customerEvidenceBlock}\n\n` : "") +
      `Rules for this channel:\n${spec.rules.map((r) => `- ${r}`).join("\n")}\n\n` +
      "NEVER state anything about this person that is not present in the material above. " +
      "No invented mutual connections, no assumed pain, no fabricated metrics, no guessed tooling.\n\n" +
      (variants > 1
        ? `Produce ${variants} DISTINCT options, each taking a genuinely different angle: ` +
          `${VARIANT_ANGLES.slice(0, variants)
            .map((a, i) => `(${i + 1}) ${a}`)
            .join(", ")}. They must not be rewordings of each other.\n\n` +
          `Reply with valid JSON only: { "drafts": [ { ${spec.hasSubject ? '"subject": "<subject>", ' : ""}"body": "<text>", "angle": "<3-6 words naming the angle>" } ] }`
        : `Reply with valid JSON only: { ${spec.hasSubject ? '"subject": "<subject>", ' : ""}"body": "<text>", "angle": "<3-6 words naming the angle>" }`);

    const call = () =>
      completeText({
        systemPrompt,
        input: input.profileSummary,
        // Sized to the channel rather than one global number: a call opener
        // needs a fraction of what three InMail variants do, and an oversized
        // cap is an invitation to ramble.
        maxOutputTokens: variants > 1 ? 1200 : 600,
        // Reasoning off, as in draft-profile.ts: the engine default is
        // Medium/High, whose thinking budget alone exceeds this cap and would
        // return an empty draft. Writing a short message from supplied
        // material is not a reasoning task.
        reasoningEffort: "none",
        // Well inside the ~20s proxy wall this deployment sits behind (see
        // persona-briefing.ts's own note on that limit).
        timeoutMs: 18_000,
      });
    const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();

    const raw = result.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Salvage a single draft from a malformed response rather than losing
      // the whole generation to a stray character.
      const body = /"body"\s*:\s*"([^"\\]*)"/.exec(raw)?.[1];
      if (!body) {
        return {
          drafts: [],
          error:
            result.stopReason === "max_tokens"
              ? "The response was cut off. Try again."
              : "The model did not return usable JSON.",
          unauthorizedCustomerMention: null,
        };
      }
      parsed = { body, subject: /"subject"\s*:\s*"([^"\\]*)"/.exec(raw)?.[1] ?? null };
    }

    const rows = Array.isArray((parsed as { drafts?: unknown }).drafts)
      ? ((parsed as { drafts: unknown[] }).drafts as Record<string, unknown>[])
      : [parsed as Record<string, unknown>];

    const drafts: OutreachDraft[] = rows
      .map((r) => ({
        kind: input.kind,
        subject: spec.hasSubject && r.subject ? stripEmDashes(String(r.subject)).slice(0, 200) : null,
        body: stripEmDashes(String(r.body ?? "")).slice(0, spec.maxBody).trim(),
        angle: r.angle ? stripEmDashes(String(r.angle)).slice(0, 80) : null,
      }))
      .filter((d) => d.body.length > 0);

    if (drafts.length === 0) {
      return { drafts: [], error: "The model returned an empty draft.", unauthorizedCustomerMention: null };
    }

    // Same check draft-profile applies: a generated message must not name a
    // customer this persona is not cleared to reference.
    const allText = drafts.map((d) => `${d.subject ?? ""} ${d.body}`).join(" ");
    return {
      drafts,
      error: null,
      unauthorizedCustomerMention: unauthorizedCustomerMentioned(allText, otherCustomerNames),
    };
  } catch (err) {
    return {
      drafts: [],
      error: err instanceof Error ? err.message : String(err),
      unauthorizedCustomerMention: null,
    };
  }
}
