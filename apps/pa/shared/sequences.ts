// Sequences (D105): named, like HubSpot's. A rep picks one for a lead after
// the first touch. Two kinds:
// - dynamic: the agent writes every email near its day, from the step's
//   purpose, and the owner approves each one;
// - template: each step is an email template; the rep reviews and edits the
//   filled-in emails when enrolling, which approves them, and each sends on
//   its day from their Gmail.
// Isomorphic: actions validate with it and the builder renders from it.
import { z } from "zod";

import { STEP_THREADS } from "./cadence.js";

export const SEQUENCE_KINDS = ["dynamic", "template"] as const;
export type SequenceKind = (typeof SEQUENCE_KINDS)[number];

export const SEQUENCE_KIND_LABELS: Record<SequenceKind, string> = {
  dynamic: "Agent-written",
  template: "Editable",
};

/** Fields a template may use; each is filled for the lead at enrollment. */
export const TEMPLATE_TOKENS = [
  { token: "first_name", label: "Their first name" },
  { token: "company", label: "Their company" },
  { token: "owner_first_name", label: "Your first name" },
  { token: "meeting_link", label: "The route's meeting link" },
] as const;

export const sequenceStepSchema = z.object({
  /** Stable within the sequence, so edits and stats follow the step. */
  id: z.string().min(1).max(40),
  /** Days after the first touch. */
  day: z.number().int().min(1).max(60),
  thread: z.enum(STEP_THREADS).default("reply"),
  /** On an exceptional lead, keep the AE on cc. */
  cc_ae: z.boolean().default(true),
  /** Dynamic: what the agent writes. Template: a note for the rep. */
  purpose: z.string().trim().max(400).default(""),
  /** Template only. A reply step's subject is the first touch's ("Re:"). */
  subject: z.string().trim().max(120).default(""),
  body: z.string().trim().max(3000).default(""),
});
export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const sequenceInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(SEQUENCE_KINDS),
    description: z.string().trim().max(300).default(""),
    /** Routes this sequence is suggested for when enrolling. */
    recommendedFor: z.array(z.string()).max(6).default([]),
    steps: z.array(sequenceStepSchema).min(1).max(10),
  })
  .superRefine((value, ctx) => {
    value.steps.forEach((step, index) => {
      if (value.kind === "dynamic" && step.purpose.length < 3)
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "purpose"],
          message: `Step ${index + 1}: say what this email is for, so the agent can write it.`,
        });
      if (value.kind === "template" && step.body.length < 10)
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "body"],
          message: `Step ${index + 1}: write the email.`,
        });
      if (value.kind === "template" && step.thread === "new" && !step.subject)
        ctx.addIssue({
          code: "custom",
          path: ["steps", index, "subject"],
          message: `Step ${index + 1} starts a new email, so it needs a subject.`,
        });
    });
  });
export type SequenceInput = z.infer<typeof sequenceInputSchema>;

/** Steps in day order. */
export const orderedSteps = <T extends { day: number }>(steps: T[]) =>
  [...steps].sort((a, b) => a.day - b.day);

/** What stops a sequence for a lead; shown as the unenroll criteria. */
export const UNENROLL_CRITERIA = [
  "They reply (an out-of-office only pauses it)",
  "They book a meeting",
  "The email bounces",
  "They opt out or ask to stop",
  "HubSpot moves them on: SAL, S0, Recycle, Disqualified, or a deal",
  "Anyone at their company replies or books",
];

/** Fills {{token}}s for one lead. Unknown or empty tokens stay visible. */
export function fillTemplate(
  text: string,
  values: Partial<
    Record<(typeof TEMPLATE_TOKENS)[number]["token"], string | null>
  >,
): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, token: string) => {
    const value = values[token as keyof typeof values];
    return value ? value : match;
  });
}

export const UNFILLED_TOKEN = /\{\{\s*[a-z_]+\s*\}\}/;
