/**
 * The one place that decides what an enrichment or phone-reveal state is
 * CALLED and what it MEANS.
 *
 * Before this existed, "not found", "failed" and "never enriched" were
 * rendered by three different inline ternaries per table, with wording that
 * disagreed between Prospects and Lead Lists. They are genuinely different
 * facts and the difference matters, so they get one definition each here and
 * every surface reads from it.
 *
 * The three questions that separate every state:
 *
 *   1. Did we ask Apollo at all?          no  → "Not looked up"       (free)
 *   2. Did Apollo answer?                 no  → "Lookup failed"       (free, RETRY)
 *   3. Did Apollo have the data?          no  → "Not in Apollo" /
 *                                                "No email on file"   (free, terminal)
 *                                         yes → the value             (CHARGED)
 *
 * Question 2 vs 3 is the distinction people were losing: **failed means we
 * never got an answer, so trying again can work. Not-found means Apollo
 * answered and the answer was no, so trying again just wastes time.**
 *
 * And the money rule, which is why `charged` is on every entry: Apollo bills
 * only for data it actually hands over. Every "nothing came back" state is
 * free, so a screen full of "No email on file" costs nothing.
 */

export type EnrichmentStatus = "idle" | "enriching" | "done" | "not_found" | "failed" | null;
export type PhoneRevealStatus = "requested" | "done" | "no_match" | "failed" | null;

export type StateTone =
  /** We have the data. */
  | "found"
  /** In flight. */
  | "pending"
  /** Nobody asked yet -- neutral, not a problem. */
  | "unasked"
  /** Apollo answered and the answer was no. Terminal; retrying is pointless. */
  | "absent"
  /** We never got an answer. Retrying can work. */
  | "error";

export interface FieldState {
  /** Short label for a table cell. */
  label: string;
  /** One sentence for a tooltip: what happened, and whether to retry. */
  detail: string;
  tone: StateTone;
  /** Did this state cost credits? */
  charged: boolean;
  /** Is trying again likely to change the answer? */
  retryable: boolean;
}

const CREDIT_NOTE = {
  free: "No credits were charged.",
  email: "Charged 1 credit.",
  phone: "Charged 8 credits.",
} as const;

/**
 * Describes an email/enrichment cell.
 *
 * `hasValue` is passed separately from `status` because `done` alone is
 * ambiguous: Apollo matched the person, but may still have had no email for
 * them. Those are different facts and users kept reading the second as a bug.
 */
export function describeEnrichmentState(
  status: EnrichmentStatus,
  hasValue: boolean,
  kind: "email" | "phone" = "email",
): FieldState {
  const noun = kind === "email" ? "email address" : "phone number";

  if (hasValue) {
    return {
      label: "Found",
      detail: `Apollo had ${kind === "email" ? "an" : "a"} ${noun} for this person. ${CREDIT_NOTE[kind]}`,
      tone: "found",
      charged: true,
      retryable: false,
    };
  }

  switch (status) {
    case "enriching":
      return {
        label: "Looking up…",
        detail: "Waiting on Apollo.",
        tone: "pending",
        charged: false,
        retryable: false,
      };

    case "done":
      // Apollo knows who this is and has no such field. This is the state most
      // often mistaken for a failure; it is a complete, correct answer.
      return {
        label: `No ${kind} on file`,
        detail: `Apollo found this person but has no ${noun} for them. This is a real answer, not an error, so retrying will return the same thing. ${CREDIT_NOTE.free}`,
        tone: "absent",
        charged: false,
        retryable: false,
      };

    case "not_found":
      return {
        label: "Not in Apollo",
        detail: `Apollo has no record of this person at all, so there is nothing to look up. Retrying will not help. ${CREDIT_NOTE.free}`,
        tone: "absent",
        charged: false,
        retryable: false,
      };

    case "failed":
      return {
        label: "Lookup failed",
        detail: `The request to Apollo did not complete, so we never found out whether they have this person. Worth retrying. ${CREDIT_NOTE.free}`,
        tone: "error",
        charged: false,
        retryable: true,
      };

    default:
      return {
        label: "Not looked up",
        detail: "Nobody has run enrichment on this lead yet.",
        tone: "unasked",
        charged: false,
        retryable: true,
      };
  }
}

/**
 * Describes a phone cell, which has its own state machine because the reveal
 * is a separate paid request answered by a webhook.
 *
 * `no_match` vs `failed` is the pair that was unclear, and it is the same
 * distinction as above: **no_match is Apollo telling us it has no number for
 * this person. failed is Apollo never telling us anything.** Only the second
 * is worth retrying, and neither is charged.
 */
export function describePhoneRevealState(
  revealStatus: PhoneRevealStatus,
  hasValue: boolean,
  enrichmentStatus: EnrichmentStatus = null,
  isStale = false,
): FieldState {
  if (hasValue) {
    return {
      label: "Found",
      detail: `Apollo revealed a phone number for this person. ${CREDIT_NOTE.phone}`,
      tone: "found",
      charged: true,
      retryable: false,
    };
  }

  if (revealStatus === "requested") {
    // Past the staleness window we stop claiming to be waiting: the webhook
    // almost certainly is not coming, and an indefinite "Revealing…" is worse
    // than admitting we do not know.
    if (!isStale) {
      return {
        label: "Revealing…",
        detail: "Asked Apollo for a number. The answer arrives by callback, usually within a minute.",
        tone: "pending",
        charged: false,
        retryable: false,
      };
    }
    return {
      label: "Reveal timed out",
      detail:
        "Apollo never sent back an answer. We cannot tell whether it found a number, so this one is held as charged until it can be reconciled against an invoice. Worth retrying.",
      tone: "error",
      // Deliberately the one "nothing came back" state still counted as
      // charged: the request may well have been processed on Apollo's side,
      // and over-counting our own budget is safer than overspending it.
      charged: true,
      retryable: true,
    };
  }

  switch (revealStatus) {
    case "no_match":
      return {
        label: "No number available",
        detail: `Apollo checked and has no phone number for this person. A real answer, not an error, so retrying returns the same thing. ${CREDIT_NOTE.free}`,
        tone: "absent",
        charged: false,
        retryable: false,
      };

    case "failed":
      return {
        label: "Reveal failed",
        detail: `The reveal request did not complete, so we never found out whether Apollo has a number. Worth retrying. ${CREDIT_NOTE.free}`,
        tone: "error",
        charged: false,
        retryable: true,
      };

    case "done":
      // Reveal completed and delivered nothing. Same class as no_match.
      return {
        label: "No number available",
        detail: `Apollo completed the reveal and returned no phone number. ${CREDIT_NOTE.free}`,
        tone: "absent",
        charged: false,
        retryable: false,
      };

    default:
      // No reveal has been requested. What the cell should say depends on
      // whether the free enrichment already told us the person is unknown --
      // offering "Reveal for 8 credits" on somebody Apollo has never heard of
      // is an invitation to waste the credits.
      if (enrichmentStatus === "not_found") {
        return {
          label: "Not in Apollo",
          detail: "Apollo has no record of this person, so there is no number to reveal.",
          tone: "absent",
          charged: false,
          retryable: false,
        };
      }
      return {
        label: "Not revealed",
        detail: "Nobody has spent the 8 credits to reveal a number for this lead.",
        tone: "unasked",
        charged: false,
        retryable: true,
      };
  }
}

/** Tailwind classes per tone, so the palette agrees across both tables. */
export const TONE_CLASS: Record<StateTone, string> = {
  found: "text-foreground",
  pending: "italic text-muted-foreground/70",
  // Neutral and quiet: "nobody asked" is not a problem to be drawn to.
  unasked: "text-muted-foreground/50",
  // Muted rather than red: Apollo answering "no" is a correct outcome, and
  // colouring it like an error is what made people read it as broken.
  absent: "text-muted-foreground/70",
  error: "text-destructive/70",
};

/** The legend rendered next to the tables, generated from the same source. */
export const ENRICHMENT_LEGEND: Array<{ label: string; meaning: string; cost: string }> = [
  {
    label: "Found",
    meaning: "Apollo had the data and we saved it.",
    cost: "1 credit for an email, 8 for a phone",
  },
  {
    label: "No email / number on file",
    meaning: "Apollo knows this person but has no such field. A real answer — retrying returns the same thing.",
    cost: "Free",
  },
  {
    label: "Not in Apollo",
    meaning: "Apollo has no record of this person at all. Nothing to look up.",
    cost: "Free",
  },
  {
    label: "Lookup / reveal failed",
    meaning: "The request never completed, so we never got an answer. Worth retrying.",
    cost: "Free",
  },
  {
    label: "Not looked up",
    meaning: "Nobody has run enrichment on this lead yet.",
    cost: "Free",
  },
];
