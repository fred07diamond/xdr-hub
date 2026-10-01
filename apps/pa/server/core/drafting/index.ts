// Drafting (SPEC 5.3 step 7, 5.5): which leads get a first-touch draft, the
// shape the drafting agent saves, and the deterministic lint every draft passes
// before anyone sees it. Nothing here sends; a draft is only ever proposed.
import { z } from "zod";

import type { EngagementState, PrecheckOutcome } from "../objects/index.js";
import type { PlaybookRelease } from "../playbook/schema.js";

/**
 * Where the owner's calendar link goes. The draft carries the placeholder; the
 * send step (M2) fills it from the owner's profile, so a draft never holds a
 * link the agent made up.
 */
export const CALENDAR_LINK_TOKEN = "[calendar link]";

/**
 * Where two 30 minute time options go (Sales handbook 03: Highly Qualified
 * Contact Sales leads get specific times). The owner, or the send step once
 * it reads their calendar, fills them; the agent never guesses availability.
 */
export const TIME_OPTIONS_TOKEN = "[time options]";

/** Signs a draft for a lead with no owner yet; filled when it is assigned. */
export const OWNER_NAME_TOKEN = "[owner first name]";

/** Where the route's meeting link goes when none is on file (D66). */
export const MEETING_LINK_TOKEN = "[meeting link]";

/**
 * The Contact Sales classes, decided before the draft is written. Each has its
 * own formula. The `hq_` codes are Exceptional and the `standard_` codes are
 * Requires discovery (D67); the codes stay so saved drafts keep their class.
 */
export const APPROACHES = [
  "hq_content",
  "standard_content",
  "content_price_check",
  "hq_code",
  "standard_code",
  "agency",
  "not_sales",
] as const;
export type Approach = (typeof APPROACHES)[number];

export const APPROACH_LABELS: Record<Approach, string> = {
  hq_content: "Exceptional, Content",
  standard_content: "Requires discovery, Content",
  content_price_check: "Content price check",
  hq_code: "Exceptional, Code",
  standard_code: "Requires discovery, Code",
  agency: "Agency routing",
  not_sales: "Not a sales request",
};

export const CTA_KINDS = ["meeting", "reply", "trial"] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

export const QUESTION_HANDLING = [
  "answered",
  "will_confirm",
  "no_question",
] as const;
export type QuestionHandling = (typeof QUESTION_HANDLING)[number];

/** The agent's reasoning for a draft (D85): required when it saves one. */
export const draftReasoningSchema = z
  .object({
    approach: z
      .string()
      .trim()
      .min(10)
      .max(600)
      .describe(
        "Why this class and route, from the signals and the playbook (for example: 1 of 5 signals, so Requires discovery; route qualify first)",
      ),
    acknowledgment: z
      .string()
      .trim()
      .min(5)
      .max(300)
      .optional()
      .describe(
        "How the opening thanks them for reaching out and names what they asked about (D86)",
      ),
    trigger: z
      .string()
      .trim()
      .min(10)
      .max(400)
      .describe("Why you opened on this trigger, in their words"),
    connection: z
      .string()
      .trim()
      .min(10)
      .max(400)
      .describe("Why this connection line fits their setup"),
    question: z
      .string()
      .trim()
      .min(10)
      .max(400)
      .describe("Why you asked this, and which gap it fills"),
    asks: z
      .array(
        z.object({
          asked: z.string().trim().min(2).max(200),
          answer: z.string().trim().min(2).max(300),
        }),
      )
      .max(6)
      .describe(
        "Each thing they asked for (a call, a demo, pricing, a plan, a question) and how the email answers it",
      ),
    tone: z
      .string()
      .trim()
      .min(10)
      .max(300)
      .describe("Why this tone, against the playbook's voice rule"),
  })
  .describe(
    "Your reasoning for the draft, shown to the PA under it (D85). Plain words; no quotes from instructions.",
  );

export const draftInputSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  approach: z
    .enum(APPROACHES)
    .describe(
      "The Contact Sales class from the Sales handbook (03), decided before drafting",
    ),
  cta: z
    .enum(CTA_KINDS)
    .describe(
      `The one call to action. "meeting" when the lead's route carries a meeting link (put that exact link in the body, or ${MEETING_LINK_TOKEN} when none is on file); "reply" when it qualifies first.`,
    ),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .describe("ISO 639-1 code; the prospect's language"),
  used_entry_ids: z
    .array(z.string().min(1))
    .max(20)
    .describe("Playbook message and knowledge entries the draft relies on"),
  rubric: z
    .object({
      trigger: z
        .string()
        .trim()
        .min(3)
        .max(300)
        .describe(
          "TCQ trigger: their exact words from the message or a form answer that the email opens on. Copied verbatim, not paraphrased.",
        ),
      connection: z
        .string()
        .trim()
        .min(3)
        .max(300)
        .describe(
          'TCQ connection: the sentence tying it to teams like theirs, e.g. "teams like yours usually..."',
        ),
      ask: z
        .string()
        .trim()
        .min(3)
        .max(300)
        .describe(
          "TCQ question: the question or the time offer, about their world, never their interest in us",
        ),
    })
    .describe("The TCQ parts of the draft, checked against the form (D62)"),
  question_handling: z
    .enum(QUESTION_HANDLING)
    .describe(
      "How the draft handles the prospect's explicit question: answered from a knowledge entry, or a line saying what will be confirmed and by when",
    ),
  reasoning: draftReasoningSchema.optional(),
});

export type DraftInput = z.infer<typeof draftInputSchema>;

const messageRuleParams = z
  .object({
    min_words: z.number().optional(),
    target_words: z.number().optional(),
    max_words: z.number().optional(),
    no_colons: z.boolean().optional(),
    banned_terms: z.array(z.string()).optional(),
    banned_chars: z.array(z.string()).optional(),
    banned_phrases: z.array(z.string()).optional(),
  })
  .passthrough();

export type DraftStatus = "proposed" | "needs_edit";

/**
 * The version of the draft rules. A draft saved under older rules is
 * redrafted while its lead is still undecided (D62).
 */
export const DRAFT_RULES_VERSION = 7;

export interface LintProblem {
  code:
    | "dash"
    | "word_range"
    | "banned_phrase"
    | "calls_to_action"
    | "calendar_link"
    | "meeting_link"
    | "question"
    | "unknown_entry"
    | "signature"
    | "colon"
    | "banned_term"
    | "pricing"
    | "length"
    | "trigger"
    | "connection"
    | "content_enterprise"
    | "questions"
    | "unanswered_ask"
    | "ae_named"
    | "internal_name"
    | "tone"
    | "acknowledgment";
  message: string;
}

export interface LintResult {
  ok: boolean;
  problems: LintProblem[];
  /** Handbook preferences that do not block, such as the 75 word target. */
  warnings: LintProblem[];
  approach: Approach;
  rulesVersion: number;
  wordCount: number;
  questionHandling: QuestionHandling;
  /** Rules that code cannot check yet, shown so nobody assumes they were. */
  notChecked: string[];
  /** The route the draft was checked against (D66), to redraft on a change. */
  route?: { route: string; link: string | null; cc?: string | null } | null;
  /** The TCQ parts and the agent's reasoning, shown under the draft (D85). */
  rubric?: DraftInput["rubric"];
  reasoning?: DraftInput["reasoning"];
}

/** The lead's route as the lint sees it (D66). */
export interface DraftRoute {
  route: string;
  /** The meeting link the email must carry, when the route has one on file. */
  link: string | null;
  /** Whether the route puts a meeting link in the email at all. */
  needsLink: boolean;
  label: string;
  /** The AE looped in on the email (D72): CC'd, and named in the body. */
  cc?: string | null;
  aeName?: string | null;
}

export interface DraftPlan {
  needed: boolean;
  /** Plain words for the PA: why there is or is not a draft. */
  reason: string;
}

/**
 * A cold first touch is drafted only for a new, routed lead with a human
 * owner. Everything else is settled without one (SPEC 5.3: steps 4 and 7 are
 * skipped when an earlier step settles the outcome).
 */
export function draftPlan(input: {
  state: EngagementState | string;
  precheck: PrecheckOutcome | string | null;
  /** The pre-check signal; owned accounts get a draft for their owner. */
  signal?: string | null;
  hasOwner: boolean;
}): DraftPlan {
  switch (input.precheck) {
    case "attach_to_owner":
      // An owned account's lead still gets a reply, drafted for its owner
      // (workflow 1b to 2b). Open deals and existing customers do not.
      if (input.signal === "existing_deal_or_customer")
        return {
          needed: false,
          reason:
            "No cold reply: an open deal or an existing customer goes to their AE.",
        };
      if (input.state !== "attached")
        return { needed: false, reason: "No draft: the lead has moved on." };
      return {
        needed: true,
        reason: "A reply is due, drafted for the account owner.",
      };
    case "route_to_support":
      return {
        needed: false,
        reason: "No sales reply: support answers this request.",
      };
    case "self_serve_thank_you":
      return {
        needed: false,
        reason:
          "No sales reply: this gets the self-serve thank-you, which ships with sending (M2).",
      };
    case "ignore_logged":
    case "disqualify_logged":
      return {
        needed: false,
        reason: "No reply: logged for the weekly spot check.",
      };
  }
  if (input.state === "first_touch_sent")
    return {
      needed: false,
      reason:
        "No draft needed: the first email already went out from HubSpot. See the contact history.",
    };
  // A routed lead with no owner yet (an empty round-robin pool) still gets a
  // draft, signed with a placeholder, so nobody starts from a blank page.
  if (input.state !== "awaiting_first_touch" && input.state !== "routed") {
    return {
      needed: false,
      reason: "No draft: this lead is not waiting for a first touch.",
    };
  }
  return {
    needed: true,
    reason: input.hasOwner
      ? "A first touch is due."
      : "A first touch is due; the lead has no owner yet, so the draft is signed with a placeholder.",
  };
}

const words = (text: string) =>
  text
    .replace(
      /\[(calendar link|meeting link|time options|owner first name)\]/gi,
      " ",
    )
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LINK = /https?:\/\/\S+|\[(calendar|meeting) link\]/gi;

const ASKS: Array<{ asked: RegExp; answered: RegExp; message: string }> = [
  {
    asked:
      /\b(book|schedule|set up|arrange|hop on|jump on|have)\b[^.?!\n]{0,30}\b(call|meeting|chat)\b|\b(call|meeting) (with|to discuss)\b|\bspeak (with|to) (someone|sales|you)\b/i,
    answered:
      /\b(call|meeting|chat|talk|time|walk ?through|session|meet)\b|\[meeting link\]|https?:\/\//i,
    message:
      "They asked for a call, and the draft does not answer that. Say yes and how it happens (the meeting link, or that you will set it up).",
  },
  {
    asked: /\bdemo\b/i,
    answered: /\b(demo|walk ?through|show you|working session)\b/i,
    message:
      "They asked for a demo, and the draft does not answer that. Say how they will see it.",
  },
  {
    asked: /\b(pric(e|es|ing)|cost|quote|how much)\b/i,
    answered: /\b(pric(e|es|ing)|cost|quote)\b/i,
    message:
      "They asked about pricing, and the draft does not acknowledge it. Say you will cover it (no numbers outside the price check).",
  },
];

/** Asks in their message that the draft leaves without a reply. */
export function unansweredAsks(asked: string | null, body: string): string[] {
  if (!asked) return [];
  return ASKS.filter(
    (item) => item.asked.test(asked) && !item.answered.test(body),
  ).map((item) => item.message);
}

/** SPEC 5.5, against the pinned release's message rules. */
export function lintDraft(input: {
  draft: DraftInput;
  release: PlaybookRelease;
  explicitQuestion: string | null;
  ownerFirstName: string | null;
  /** The message and form answers the trigger must come from (D62). */
  sourceText?: string | null;
  /** The lead's route (D66): whose meeting link the email carries, if any. */
  route?: DraftRoute | null;
  /** Their form message, to check every ask in it gets a reply (D71). */
  askedText?: string | null;
}): LintResult {
  const { draft, release } = input;
  const params = messageRuleParams.parse(
    release.entries.find((entry) => entry.id === "msg.first_touch.structure")
      ?.params ?? {},
  );
  const problems: LintProblem[] = [];
  const warnings: LintProblem[] = [];
  const text = `${draft.subject}\n${draft.body}`;

  const bannedChars = params.banned_chars ?? ["—", "–"];
  if (bannedChars.some((char) => text.includes(char))) {
    problems.push({
      code: "dash",
      message: "Uses an em dash or en dash.",
    });
  }

  const count = words(draft.body);
  const min = params.min_words ?? 0;
  const max = params.max_words ?? Number.POSITIVE_INFINITY;
  if (count < min || count > max) {
    problems.push({
      code: "word_range",
      message: `${count} words; the message rule asks for ${min} to ${max}.`,
    });
  }

  if (params.target_words && count > params.target_words && count <= max) {
    warnings.push({
      code: "length",
      message: `${count} words; the handbook aims for under ${params.target_words} when possible.`,
    });
  }

  if (params.no_colons) {
    // Times (10:30) and link schemes are not punctuation colons.
    const stripped = text
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\d:\d\d/g, "");
    if (stripped.includes(":")) {
      problems.push({
        code: "colon",
        message:
          "Uses a colon; the handbook allows none in subjects or bodies.",
      });
    }
  }

  for (const term of params.banned_terms ?? []) {
    // Whole word, case-sensitive: "Publish" the product, not "publishing".
    const pattern = new RegExp(`(^|[^\\w.])${escapeRegExp(term)}(?!\\w)`);
    if (pattern.test(text)) {
      problems.push({
        code: "banned_term",
        message: `Says "${term}"; say Builder externally.`,
      });
    }
  }

  if (
    draft.approach !== "content_price_check" &&
    /\$\s?\d|\b\d+(\.\d+)?\s?k\b|\bper (seat|user|editor|month)\b/i.test(text)
  ) {
    problems.push({
      code: "pricing",
      message:
        "Mentions a price; pricing is disclosed only in the Content price check.",
    });
  }

  const lower = text.toLowerCase();
  for (const phrase of params.banned_phrases ?? []) {
    if (lower.includes(phrase.toLowerCase())) {
      problems.push({
        code: "banned_phrase",
        message: `Uses a banned phrase: "${phrase}".`,
      });
    }
  }

  const links = draft.body.match(LINK) ?? [];
  if (links.length > 1) {
    problems.push({
      code: "calls_to_action",
      message: `Has ${links.length} links; a first touch has one call to action.`,
    });
  }
  // The route decides the ask (D66): a meeting route carries that person's
  // meeting link, and a qualify-first route carries no link yet.
  const route = input.route ?? null;
  if (route?.needsLink) {
    const expected = route.link ?? MEETING_LINK_TOKEN;
    if (!draft.body.includes(expected)) {
      problems.push({
        code: "meeting_link",
        message: route.link
          ? `The route is "${route.label}", so the email needs the meeting link ${route.link}.`
          : `The route is "${route.label}", but no meeting link is on file. Put ${MEETING_LINK_TOKEN} where it goes.`,
      });
    }
  } else if (route && links.length > 0) {
    problems.push({
      code: "meeting_link",
      message: `The route is "${route.label}", so no meeting link yet. Ask the questions first.`,
    });
  } else if (
    !route &&
    draft.cta === "meeting" &&
    links.length === 0 &&
    !draft.body.toLowerCase().includes(TIME_OPTIONS_TOKEN)
  ) {
    problems.push({
      code: "meeting_link",
      message: `The call to action is a meeting, but there is no meeting link. Put ${MEETING_LINK_TOKEN} where it goes.`,
    });
  }

  // TCQ (D62). Trigger: their own words, used in the email.
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^\p{L}\p{N}' ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (input.sourceText !== undefined) {
    const trigger = normalize(draft.rubric.trigger);
    const source = normalize(input.sourceText ?? "");
    if (!source.includes(trigger)) {
      problems.push({
        code: "trigger",
        message:
          "The trigger is not their words. Quote the specific thing they wrote in the message or a form answer.",
      });
    } else {
      const keyWords = trigger.split(" ").filter((word) => word.length >= 5);
      const used = keyWords.filter((word) =>
        normalize(draft.body).includes(word),
      );
      if (keyWords.length > 0 && used.length < Math.min(2, keyWords.length)) {
        problems.push({
          code: "trigger",
          message:
            "The email does not open on the trigger. Reference what they actually wrote.",
        });
      }
    }
  }
  if (
    (draft.approach === "hq_content" ||
      draft.approach === "standard_content") &&
    !/\benterprise\b/i.test(draft.body)
  ) {
    problems.push({
      code: "content_enterprise",
      message:
        "A Content lead should hear, in one line, that the CMS is part of the Enterprise plan.",
    });
  }
  // An exceptional lead meets the AE (D72): name them in the email.
  const aeFirst = route?.aeName?.trim().split(/\s+/)[0] ?? null;
  if (
    route?.cc &&
    aeFirst &&
    !new RegExp(`\\b${escapeRegExp(aeFirst)}\\b`, "i").test(
      draft.body.replace(/https?:\/\/\S+/g, " "),
    )
  ) {
    problems.push({
      code: "ae_named",
      message: `The AE, ${route.aeName}, is looped in on this email. Name them and say what the meeting with them is for.`,
    });
  }

  // Acknowledgment (D86): the email opens by thanking them for reaching out.
  {
    const opening = draft.body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    if (
      !/\b(thanks|thank you)\b[^.!?]{0,80}\b(reaching out|getting in touch|contacting|your (note|message|interest|inquiry|enquiry|request|question))\b/i.test(
        opening,
      ) &&
      // In the prospect's language too.
      !/\bgracias\b[^.!?]{0,80}\b(escribir(nos)?|contactar(nos)?|tu (mensaje|inter[eé]s|consulta)|su (mensaje|inter[eé]s|consulta))/i.test(
        opening,
      )
    )
      problems.push({
        code: "acknowledgment",
        message:
          'Open by thanking them for reaching out and naming what they asked about, for example "Thanks for reaching out about Builder\'s visual CMS."',
      });
  }

  // TCQ (D85): the connection is in the email, not only in the rubric.
  {
    const norm = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    const words = norm(draft.rubric.connection)
      .split(" ")
      .filter((word) => word.length >= 5);
    const body = norm(draft.body);
    const used = words.filter((word) => body.includes(word));
    if (words.length > 0 && used.length < Math.min(2, words.length))
      problems.push({
        code: "connection",
        message:
          "The email has no connection line. Add one sentence that ties what they said to their setup, in plain words.",
      });
  }

  // Customers do not know PA's internal names for the products (D85).
  if (
    /\b(is|it's|that's|called|named|the) (Content|Code)\b(?! (team|management|editors?|pages?|types?))/.test(
      draft.body,
    ) ||
    /\b(Content|Code) (plan|product|space)\b/i.test(draft.body)
  )
    problems.push({
      code: "internal_name",
      message:
        'Uses an internal product name ("Content" or "Code"). Say what it is, for example "Builder\'s CMS" or "the visual editor".',
    });

  // Professional and warm, not slangy (D85).
  const slang = draft.body.match(
    /^\s*(hey|hiya|yo)\b|\b(yep|yup|yeah|nope|gotcha|gonna|wanna|kinda|sorta)\b/im,
  );
  if (slang)
    problems.push({
      code: "tone",
      message: `"${slang[0].trim()}" is too casual. Professional and warm, plain English; open with "Hi <first name>,".`,
    });

  // Questions (D71): a couple that matter, never an interrogation.
  const questionMarks = (draft.body.match(/\?/g) ?? []).length;
  if (questionMarks > 2) {
    problems.push({
      code: "questions",
      message: `Asks ${questionMarks} questions. Ask at most two, the ones that matter most.`,
    });
  } else if (
    questionMarks === 0 &&
    (route ? !route.needsLink : draft.cta !== "meeting")
  ) {
    problems.push({
      code: "questions",
      message:
        "No meeting link on this route, so ask one or two questions to move it forward.",
    });
  }

  // Everything they asked for gets a reply (D71): a call, a demo, pricing.
  for (const ask of unansweredAsks(input.askedText ?? null, draft.body)) {
    problems.push({ code: "unanswered_ask", message: ask });
  }

  if (input.explicitQuestion) {
    if (draft.question_handling === "no_question") {
      problems.push({
        code: "question",
        message: "They asked a question, and the draft does not answer it.",
      });
    }
  }

  const known = new Set(release.entries.map((entry) => entry.id));
  for (const id of draft.used_entry_ids) {
    if (!known.has(id)) {
      problems.push({
        code: "unknown_entry",
        message: `Cites ${id}, which is not in this playbook release.`,
      });
    }
  }

  {
    const signer = input.ownerFirstName ?? OWNER_NAME_TOKEN;
    const lines = draft.body
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const last = lines.slice(-2).join(" ");
    if (!last.includes(signer)) {
      problems.push({
        code: "signature",
        message: input.ownerFirstName
          ? `Not signed with the owner's first name (${input.ownerFirstName}).`
          : `The lead has no owner yet; sign with ${OWNER_NAME_TOKEN}.`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    approach: draft.approach,
    rulesVersion: DRAFT_RULES_VERSION,
    wordCount: count,
    questionHandling: draft.question_handling,
    notChecked: [
      "Customer names need an approved reference entry",
      "Whether the questions pass the peer test",
    ],
    route: route
      ? { route: route.route, link: route.link, cc: route.cc ?? null }
      : null,
    rubric: draft.rubric,
    reasoning: draft.reasoning,
  };
}

/** What a TCQ trigger may quote: the message and every form answer. */
export function triggerSource(submission: {
  message: string | null;
  fields: Record<string, unknown>;
  companyName?: string | null;
}): string {
  return [
    submission.message ?? "",
    submission.companyName ?? "",
    ...Object.values(submission.fields).filter(
      (value): value is string => typeof value === "string",
    ),
  ].join("\n");
}

export const firstName = (displayName: string | null | undefined) =>
  displayName?.trim().split(/\s+/)[0] ?? null;
