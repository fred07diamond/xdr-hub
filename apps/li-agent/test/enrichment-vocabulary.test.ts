import { describe, expect, it } from "vitest";

import {
  describeEnrichmentState,
  describePhoneRevealState,
  ENRICHMENT_LEGEND,
  TONE_CLASS,
} from "../app/lib/enrichment-vocabulary.js";

// The vocabulary these tests pin down is the answer to a specific complaint:
// "not found", "failed" and "not enriched" were indistinguishable, and so were
// a phone "no match" and a phone "failed". The distinction that matters is
// whether Apollo ANSWERED, because that decides whether retrying is worth
// anything -- and separately, whether we were CHARGED.

describe("describeEnrichmentState — the three states people confused", () => {
  it("separates never-asked from asked-and-refused from no-answer", () => {
    const unasked = describeEnrichmentState("idle", false);
    const absent = describeEnrichmentState("not_found", false);
    const failed = describeEnrichmentState("failed", false);

    // All three used to render as some flavour of muted dash or "failed".
    expect(new Set([unasked.label, absent.label, failed.label]).size).toBe(3);
    expect(unasked.tone).toBe("unasked");
    expect(absent.tone).toBe("absent");
    expect(failed.tone).toBe("error");
  });

  it("marks only the no-answer state as worth retrying", () => {
    // This is the whole practical point of the distinction: Apollo answering
    // "we don't have them" will answer the same way next time.
    expect(describeEnrichmentState("not_found", false).retryable).toBe(false);
    expect(describeEnrichmentState("done", false).retryable).toBe(false);
    expect(describeEnrichmentState("failed", false).retryable).toBe(true);
    expect(describeEnrichmentState("idle", false).retryable).toBe(true);
  });

  it("distinguishes 'matched but no email' from 'not in Apollo'", () => {
    // Both show an empty cell, and they are different facts: one means Apollo
    // has the person, the other means it has never heard of them.
    const noEmail = describeEnrichmentState("done", false, "email");
    const notInApollo = describeEnrichmentState("not_found", false, "email");
    expect(noEmail.label).toBe("No email on file");
    expect(notInApollo.label).toBe("Not in Apollo");
    expect(noEmail.detail).not.toBe(notInApollo.detail);
  });

  it("charges ONLY when data actually came back", () => {
    expect(describeEnrichmentState("done", true).charged).toBe(true);
    for (const status of ["idle", "done", "not_found", "failed", "enriching"] as const) {
      expect(describeEnrichmentState(status, false).charged, status).toBe(false);
    }
  });

  it("does not colour an Apollo 'no' like an error", () => {
    // Styling not_found as destructive is what made a perfectly good answer
    // read as a broken integration.
    expect(TONE_CLASS[describeEnrichmentState("not_found", false).tone]).not.toContain("destructive");
    expect(TONE_CLASS[describeEnrichmentState("done", false).tone]).not.toContain("destructive");
    expect(TONE_CLASS[describeEnrichmentState("failed", false).tone]).toContain("destructive");
  });

  it("says outright that an empty result was free", () => {
    for (const status of ["done", "not_found", "failed"] as const) {
      expect(describeEnrichmentState(status, false).detail, status).toContain("No credits were charged");
    }
  });

  it("names the field in the label, so a phone cell never says 'email'", () => {
    expect(describeEnrichmentState("done", false, "phone").label).toBe("No phone on file");
  });
});

describe("describePhoneRevealState — no_match vs failed", () => {
  it("treats no_match as a real answer and failed as no answer", () => {
    const noMatch = describePhoneRevealState("no_match", false);
    const failed = describePhoneRevealState("failed", false);

    expect(noMatch.label).toBe("No number available");
    expect(failed.label).toBe("Reveal failed");
    // The actionable difference.
    expect(noMatch.retryable).toBe(false);
    expect(failed.retryable).toBe(true);
    // Neither costs anything.
    expect(noMatch.charged).toBe(false);
    expect(failed.charged).toBe(false);
  });

  it("charges only a reveal that produced a number", () => {
    expect(describePhoneRevealState("done", true).charged).toBe(true);
    expect(describePhoneRevealState("no_match", false).charged).toBe(false);
    expect(describePhoneRevealState("done", false).charged).toBe(false);
  });

  it("stops claiming to be waiting once the reveal is stale", () => {
    const waiting = describePhoneRevealState("requested", false, null, false);
    const stale = describePhoneRevealState("requested", false, null, true);
    expect(waiting.label).toBe("Revealing…");
    expect(stale.label).toBe("Reveal timed out");
    // A timeout is the ONE empty state still held as charged: Apollo may have
    // processed it and we cannot tell.
    expect(waiting.charged).toBe(false);
    expect(stale.charged).toBe(true);
    expect(stale.retryable).toBe(true);
  });

  it("does not offer a reveal on someone Apollo has never heard of", () => {
    // Spending 8 credits to reveal a number for a person Apollo has no record
    // of is the most avoidable waste in the app.
    const unknownPerson = describePhoneRevealState(null, false, "not_found");
    expect(unknownPerson.label).toBe("Not in Apollo");
    expect(unknownPerson.retryable).toBe(false);

    const knownPerson = describePhoneRevealState(null, false, "done");
    expect(knownPerson.label).toBe("Not revealed");
    expect(knownPerson.retryable).toBe(true);
  });

  it("quotes the right price in each detail string", () => {
    expect(describePhoneRevealState("done", true).detail).toContain("8 credits");
    expect(describeEnrichmentState("done", true, "email").detail).toContain("1 credit");
  });
});

describe("ENRICHMENT_LEGEND", () => {
  it("marks every empty state as free", () => {
    const free = ENRICHMENT_LEGEND.filter((r) => r.cost === "Free").map((r) => r.label);
    expect(free).toContain("Not in Apollo");
    expect(free).toContain("Lookup / reveal failed");
    expect(free).toContain("No email / number on file");
    expect(free).toContain("Not looked up");
  });

  it("charges only the Found row", () => {
    const charged = ENRICHMENT_LEGEND.filter((r) => r.cost !== "Free");
    expect(charged).toHaveLength(1);
    expect(charged[0].label).toBe("Found");
  });

  it("explains retryability in plain language, not jargon", () => {
    const failed = ENRICHMENT_LEGEND.find((r) => r.label === "Lookup / reveal failed");
    expect(failed?.meaning).toMatch(/retry/i);
    const absent = ENRICHMENT_LEGEND.find((r) => r.label === "Not in Apollo");
    expect(absent?.meaning).not.toMatch(/retry/i);
  });
});
