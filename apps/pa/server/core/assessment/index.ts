import { z } from "zod";

export const ASSESSMENT_INTENTS = [
  "sales",
  "support",
  "educational",
  "selling_to_us",
  "job_seeker",
  "junk",
  "other",
] as const;
export type AssessmentIntent = (typeof ASSESSMENT_INTENTS)[number];

export const PRODUCT_INTERESTS = [
  "content",
  "code",
  "both",
  "unknown",
] as const;
export type ProductInterest = (typeof PRODUCT_INTERESTS)[number];

// ISO 639-1 codes the drafting step can write in.
export const SUPPORTED_LANGUAGES = new Set([
  "en",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "nl",
  "sv",
  "da",
  "no",
  "fi",
  "pl",
  "cs",
  "ro",
  "hu",
  "el",
  "tr",
  "ru",
  "uk",
  "he",
  "ar",
  "hi",
  "id",
  "vi",
  "th",
  "ja",
  "ko",
  "zh",
]);

export const assessmentInputSchema = z.object({
  intent: z.enum(ASSESSMENT_INTENTS),
  agency_signal: z.boolean(),
  // Three non-space characters at least, so a stray space or letter cannot
  // pass as evidence (FR-4).
  evidence_quotes: z
    .array(
      z
        .string()
        .max(400)
        .refine(
          (quote) => quote.replace(/\s/g, "").length >= 3,
          "a quote needs at least 3 non-space characters",
        ),
    )
    .max(8),
  end_client_named: z.boolean(),
  product_interest: z.enum(PRODUCT_INTERESTS),
  language: z.string().min(2).max(3),
  explicit_question: z.string().min(1).max(600).nullable(),
});
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;

export type AssessmentValidation =
  | { ok: true; value: AssessmentInput }
  | { ok: false; errors: string[] };

export function validateAssessment(
  input: unknown,
  message: string | null | undefined,
): AssessmentValidation {
  const parsed = assessmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
      ),
    };
  }
  const value = parsed.data;
  const text = message ?? "";
  const errors: string[] = [];
  value.evidence_quotes.forEach((quote, index) => {
    if (!text.includes(quote)) {
      errors.push(
        `evidence_quotes.${index}: not an exact substring of the message`,
      );
    }
  });
  if (
    value.explicit_question !== null &&
    !text.includes(value.explicit_question)
  ) {
    errors.push(
      "explicit_question: must be copied exactly from the message, in their words",
    );
  }
  if (
    (value.agency_signal || value.end_client_named) &&
    value.evidence_quotes.length === 0
  ) {
    errors.push(
      "evidence_quotes: an agency signal or a named end client needs an exact quote from the message",
    );
  }
  if (!SUPPORTED_LANGUAGES.has(value.language)) {
    errors.push(
      `language: ${value.language} is not a supported ISO 639-1 code`,
    );
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
