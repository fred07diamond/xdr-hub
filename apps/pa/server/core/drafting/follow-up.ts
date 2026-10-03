// The message checks for a follow-up (D101). A follow-up is a short reply in
// the first touch's thread, so it keeps the first touch's hard rules (no
// dashes, banned terms and phrases, the length cap) but not its structure
// (no acknowledgment, no TCQ), and adds one rule of its own: it must not
// repeat an email the lead already got.
import type { PlaybookRelease } from "../playbook/schema.js";
import { MEETING_LINK_TOKEN, OWNER_NAME_TOKEN } from "./index.js";

/** 2: a follow-up must read like an email (D106). */
export const FOLLOW_UP_RULES_VERSION = 2;
/** Follow-ups are shorter than a first touch. */
export const FOLLOW_UP_MIN_WORDS = 15;

export interface FollowUpProblem {
  code: string;
  message: string;
}

export interface FollowUpLint {
  ok: boolean;
  problems: FollowUpProblem[];
  wordCount: number;
  rulesVersion: number;
}

const wordsOf = (text: string) =>
  text
    .replace(/\[(meeting link|calendar link|owner first name)\]/gi, " ")
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Share of this email's three-word runs that appeared in an earlier email. */
export function overlap(text: string, earlier: string): number {
  const grams = (value: string) => {
    const words = norm(value).split(" ").filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 2 < words.length; i += 1)
      set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    return set;
  };
  const mine = grams(text);
  if (mine.size === 0) return 0;
  const theirs = grams(earlier);
  let shared = 0;
  for (const gram of mine) if (theirs.has(gram)) shared += 1;
  return shared / mine.size;
}

/** Common sign-offs repeat by design, so they do not count as repeating. */
const SIGN_OFF =
  /\n\s*(looking forward to your response|best|thanks|cheers|talk soon)[,!.]?\s*\n[^\n]*$/i;

export function lintFollowUp(input: {
  body: string;
  release: PlaybookRelease;
  /** The first touch and earlier follow-ups the lead already got. */
  earlier: string[];
  /** The meeting link the route carries, when the step offers one. */
  link: string | null;
  /** A new-email step (D104): its subject, checked too. */
  subject?: string | null;
  newThread?: boolean;
}): FollowUpLint {
  const params = (input.release.entries.find(
    (entry) => entry.id === "msg.first_touch.structure",
  )?.params ?? {}) as {
    max_words?: number;
    banned_chars?: string[];
    banned_terms?: string[];
    banned_phrases?: string[];
  };
  const problems: FollowUpProblem[] = [];
  const body = input.body;
  const count = wordsOf(body).length;
  const max = params.max_words ?? 75;
  if (count < FOLLOW_UP_MIN_WORDS || count > max)
    problems.push({
      code: "word_range",
      message: `A follow-up is ${FOLLOW_UP_MIN_WORDS} to ${max} words; this one is ${count}.`,
    });
  if ((params.banned_chars ?? ["—", "–"]).some((c) => body.includes(c)))
    problems.push({ code: "dash", message: "Uses an em dash or en dash." });
  const lower = body.toLowerCase();
  for (const term of params.banned_terms ?? [])
    if (
      new RegExp(
        `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(body)
    )
      problems.push({
        code: "banned_term",
        message: `Uses "${term}"; say "Builder" or describe the product instead.`,
      });
  for (const phrase of params.banned_phrases ?? [])
    if (lower.includes(phrase.toLowerCase()))
      problems.push({
        code: "banned_phrase",
        message: `Uses "${phrase}".`,
      });
  if (
    /just (circling|checking|following) (back|in|up)|bumping this/i.test(body)
  )
    problems.push({
      code: "empty_bump",
      message:
        'Reads as an empty bump ("just checking in"). Give them something new: an example, an angle, or one question.',
    });
  if (body.includes(MEETING_LINK_TOKEN) && !input.link)
    problems.push({
      code: "meeting_link",
      message:
        "Has [meeting link] but the route has no meeting link on file. Add it on the lead, or drop the offer.",
    });
  if (
    /\[(?!meeting link\]|owner first name\])[^\]\n]{1,40}\](?!\()/i.test(body)
  )
    problems.push({
      code: "placeholder",
      message: "Has a placeholder left in brackets. Write the real words.",
    });
  // Formatted like a real email (D106): a greeting line, a blank line, the
  // message, then a sign-off line and the sender's name.
  const lines = body.split("\n").map((line) => line.trim());
  const filled = lines.filter(Boolean);
  if (
    !/^(hi|hey|hello|dear|good (morning|afternoon))\b[^\n]{0,40},$/i.test(
      filled[0] ?? "",
    )
  )
    problems.push({
      code: "greeting",
      message:
        'Start with a greeting on its own line, like "Hi Jake,", then a blank line.',
    });
  else if (lines[1] !== "")
    problems.push({
      code: "greeting",
      message: "Leave a blank line after the greeting.",
    });
  const name = filled[filled.length - 1] ?? "";
  const signOff = filled[filled.length - 2] ?? "";
  if (
    filled.length < 4 ||
    name.length > 40 ||
    !/,$/.test(signOff) ||
    signOff.length > 40
  )
    problems.push({
      code: "signoff",
      message:
        'End with a sign-off line and your name on the next line, like "Best," then [owner first name].',
    });
  if (input.newThread) {
    const subject = (input.subject ?? "").trim();
    if (!subject)
      problems.push({
        code: "subject",
        message: "This step starts a new email, so it needs a subject.",
      });
    else if (subject.length > 80)
      problems.push({
        code: "subject",
        message: "Keep the subject under 80 characters.",
      });
    else if (/^re:/i.test(subject))
      problems.push({
        code: "subject",
        message: 'A new email should not start with "Re:".',
      });
    if (
      (params.banned_chars ?? ["\u2014", "\u2013"]).some((c) =>
        subject.includes(c),
      )
    )
      problems.push({
        code: "dash",
        message: "The subject uses an em dash or en dash.",
      });
  }
  const core = body.replace(SIGN_OFF, "");
  for (const earlier of input.earlier) {
    if (overlap(core, earlier.replace(SIGN_OFF, "")) > 0.35) {
      problems.push({
        code: "repeats",
        message: "Repeats an earlier email. Each follow-up says something new.",
      });
      break;
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    wordCount: count,
    rulesVersion: FOLLOW_UP_RULES_VERSION,
  };
}

/** The owner's name and the meeting link, filled at send time. */
export function fillFollowUp(
  body: string,
  values: { firstName: string | null; link: string | null },
) {
  let text = body;
  if (values.firstName)
    text = text.split(OWNER_NAME_TOKEN).join(values.firstName);
  if (values.link) text = text.split(MEETING_LINK_TOKEN).join(values.link);
  return text;
}
