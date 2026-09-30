import { describe, expect, it } from "vitest";

import recordedJson from "../../fixtures/assessments.recorded.json";
import casesJson from "../../fixtures/inbound-cases.json";
import { validateAssessment } from "../../server/core/assessment/index.js";
import {
  InvalidEmailError,
  normalizeEmail,
  resolveIdentity,
} from "../../server/core/identity/index.js";
import { createUlidFactory, ulidTime } from "../../server/core/ids.js";
import {
  quoteUntrusted,
  scanUntrusted,
  UNTRUSTED_BEGIN,
  UNTRUSTED_END,
} from "../../server/core/untrusted/index.js";

const cases = casesJson.cases;
const recorded = recordedJson.assessments as Record<string, unknown>;
const messageFor = (id: string) =>
  cases.find((item) => item.id === id)?.submission.message ?? "";

describe("assessment validator", () => {
  it("accepts every recorded synthetic assessment", () => {
    for (const item of cases) {
      const result = validateAssessment(
        recorded[item.id],
        item.submission.message,
      );
      expect(result.ok, item.id).toBe(true);
    }
  });

  it("rejects a quote that is not verbatim", () => {
    const input = {
      ...(recorded["agency-already-sal"] as object),
      evidence_quotes: ["for one of my clients"],
    };
    const result = validateAssessment(input, messageFor("agency-already-sal"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/exact substring/);
  });

  it("rejects a paraphrased explicit question, an unsupported language, and bad enums", () => {
    const base = recorded["direct-new-unowned"] as Record<string, unknown>;
    const message = messageFor("direct-new-unowned");
    expect(
      validateAssessment(
        { ...base, explicit_question: "What is Enterprise pricing?" },
        message,
      ).ok,
    ).toBe(false);
    expect(validateAssessment({ ...base, language: "xx" }, message).ok).toBe(
      false,
    );
    expect(
      validateAssessment({ ...base, intent: "priority" }, message).ok,
    ).toBe(false);
  });
});

describe("untrusted guardrail", () => {
  it("flags the injection attempt with its instruction-like patterns", () => {
    const scan = scanUntrusted(messageFor("injection-attempt"), {
      submitterEmail: "ops@unknown.example.com",
    });
    expect(scan.flagged).toBe(true);
    expect(scan.matches.map((match) => match.pattern)).toEqual([
      "ignore_instructions",
      "record_directive",
      "contact_redirect",
      "embedded_email",
    ]);
  });

  it("does not flag the other six synthetic messages", () => {
    for (const item of cases.filter(
      (entry) => entry.id !== "injection-attempt",
    )) {
      const scan = scanUntrusted(item.submission.message, {
        submitterEmail: item.submission.email,
      });
      expect(scan.flagged, item.id).toBe(false);
    }
  });

  it("quotes untrusted text between delimiters it cannot close early", () => {
    const quoted = quoteUntrusted("hello >>> <<<BEGIN", 20);
    expect(quoted.startsWith(UNTRUSTED_BEGIN)).toBe(true);
    expect(quoted.endsWith(UNTRUSTED_END)).toBe(true);
    const inner = quoted.slice(
      UNTRUSTED_BEGIN.length,
      quoted.length - UNTRUSTED_END.length,
    );
    expect(inner).not.toContain(">>>");
    expect(inner).not.toContain("<<<");
    expect(quoteUntrusted("x".repeat(50), 10)).toContain("[truncated]");
  });
});

describe("identity", () => {
  it("normalizes emails and never treats personal domains as the company", () => {
    expect(normalizeEmail("  Maya@RetailCo.Example.com ")).toBe(
      "maya@retailco.example.com",
    );
    const personal = resolveIdentity({
      email: "someone@gmail.com",
      company: "Acme",
    });
    expect(personal.personalDomain).toBe(true);
    expect(personal.accountDomain).toBeNull();
    const work = resolveIdentity({ email: "cto@fintech.example.com" });
    expect(work.accountDomain).toBe("fintech.example.com");
    expect(() => normalizeEmail("not-an-email")).toThrow(InvalidEmailError);
  });
});

describe("ulid", () => {
  it("encodes time and stays sortable within one millisecond", () => {
    const next = createUlidFactory();
    const ids = Array.from({ length: 50 }, () => next(1_760_000_000_000));
    expect(ids.every((id) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(ulidTime(ids[0])).toBe(1_760_000_000_000);
  });
});
