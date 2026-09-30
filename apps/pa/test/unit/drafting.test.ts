// Drafting (SPEC 5.5, D49): which leads get a draft, the deterministic lint,
// and the one-glance summary a PA reads first.
import { describe, expect, it } from "vitest";

import { buildDemoData } from "../../server/core/demo/index.js";
import {
  draftPlan,
  lintDraft,
  type DraftInput,
} from "../../server/core/drafting/index.js";
import { seedRelease } from "../../server/core/playbook/release.js";

const good: DraftInput = {
  subject: "Your marketing site move",
  body: [
    "Hi Priya,",
    "Saw you're moving your marketing site to a headless CMS. Our CMS is part of the Enterprise plan, and I'll send the SSO details over tomorrow.",
    "Would Wednesday or Thursday work for 30 minutes to walk through your setup?",
    "Thanks,",
    "Dana",
  ].join("\n\n"),
  approach: "hq_content",
  cta: "meeting",
  language: "en",
  used_entry_ids: ["msg.first_touch.structure"],
  rubric: {
    trigger: "moving our marketing site to a headless CMS",
    connection: "Our CMS is part of the Enterprise plan",
    ask: "Would Wednesday or Thursday work for 30 minutes?",
  },
  question_handling: "will_confirm",
};

const SOURCE =
  "We are moving our marketing site to a headless CMS. Can you share whether you support SSO?";

const lint = (draft: Partial<DraftInput>, question: string | null = "Q?") =>
  lintDraft({
    draft: { ...good, ...draft },
    release: seedRelease,
    explicitQuestion: question,
    ownerFirstName: "Dana",
    sourceText: SOURCE,
  });

const codes = (draft: Partial<DraftInput>, question?: string | null) =>
  lint(draft, question).problems.map((problem) => problem.code);

describe("draftPlan", () => {
  it("drafts a new, routed lead, with or without an owner yet", () => {
    expect(
      draftPlan({
        state: "awaiting_first_touch",
        precheck: "continue",
        hasOwner: true,
      }).needed,
    ).toBe(true);
    expect(
      draftPlan({ state: "routed", precheck: "continue", hasOwner: false })
        .needed,
    ).toBe(true);
    expect(
      draftPlan({ state: "closed", precheck: "continue", hasOwner: true })
        .needed,
    ).toBe(false);
    // An owned account's lead is drafted for its owner; an open deal or an
    // existing customer is not.
    expect(
      draftPlan({
        state: "attached",
        precheck: "attach_to_owner",
        signal: "owned_account",
        hasOwner: true,
      }).needed,
    ).toBe(true);
    expect(
      draftPlan({
        state: "attached",
        precheck: "attach_to_owner",
        signal: "existing_deal_or_customer",
        hasOwner: true,
      }).needed,
    ).toBe(false);
    for (const precheck of [
      "route_to_support",
      "self_serve_thank_you",
      "ignore_logged",
      "disqualify_logged",
    ]) {
      const plan = draftPlan({ state: "attached", precheck, hasOwner: true });
      expect(plan.needed, precheck).toBe(false);
      expect(plan.reason, precheck).toMatch(/^No /);
    }
  });
});

describe("lintDraft", () => {
  it("passes a draft that follows the message rules", () => {
    const result = lint({});
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notChecked.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
    // Times and links are not punctuation colons.
    expect(
      codes({
        body: good.body.replace(
          "Wednesday or Thursday",
          "Wednesday at 10:30am or Thursday",
        ),
      }),
    ).not.toContain("colon");
  });

  it("catches each rule", () => {
    expect(
      codes({ body: good.body.replace("Saw you're", "Saw — you're") }),
    ).toContain("dash");
    expect(codes({ body: "Hi,\n\nShort.\n\nDana" })).toContain("word_range");
    expect(codes({ subject: "Pricing: the details" })).toContain("colon");
    for (const term of ["Builder.io", "Fusion", "Publish"])
      expect(
        codes({ body: good.body.replace("SSO details", `${term} details`) }),
        term,
      ).toContain("banned_term");
    expect(
      codes({ body: good.body.replace("SSO details", "publishing details") }),
    ).not.toContain("banned_term");
    expect(
      codes({ body: good.body.replace("SSO details", "price (around 25k)") }),
    ).toContain("pricing");
    expect(
      codes({
        approach: "content_price_check",
        body: good.body.replace("SSO details", "price (around 25k)"),
      }),
    ).not.toContain("pricing");
    expect(
      codes({ body: good.body.replace("Thanks,", "Best regards,") }),
    ).toContain("banned_phrase");
    expect(
      codes({
        body: good.body.replace(
          "Saw you're",
          "I hope this email finds you well. Saw you're",
        ),
      }),
    ).toContain("banned_phrase");
    expect(
      codes({
        body: `${good.body}\nhttps://example.com/a and https://example.com/b`,
      }),
    ).toContain("calls_to_action");
    expect(
      codes({ body: good.body.replace("Wednesday or Thursday", "sometime") }),
    ).toContain("calendar_link");
    expect(codes({ question_handling: "no_question" })).toContain("question");
    // TCQ (D62): the trigger is their words, used in the email.
    expect(
      codes({ rubric: { ...good.rubric, trigger: "evaluating CMS options" } }),
    ).toContain("trigger");
    expect(
      codes({
        body: good.body.replace(
          "Saw you're moving your marketing site to a headless CMS.",
          "Thanks for reaching out.",
        ),
      }),
    ).toContain("trigger");
    expect(
      codes({
        body: good.body.replace("part of the Enterprise plan", "a paid plan"),
      }),
    ).toContain("content_enterprise");
    expect(codes({ approach: "standard_content", cta: "reply" })).toContain(
      "questions",
    );
    expect(
      codes({
        body: good.body.replace(
          "and I'll send",
          "Builder can help teams, and I'll send",
        ),
      }),
    ).toContain("banned_phrase");
    expect(codes({ used_entry_ids: ["kb.made_up"] })).toContain(
      "unknown_entry",
    );
    expect(codes({ body: good.body.replace("Dana", "The team") })).toContain(
      "signature",
    );
  });

  it("does not ask for an answer when there was no question", () => {
    expect(codes({ question_handling: "no_question" }, null)).not.toContain(
      "question",
    );
  });
});

describe("the demo board, as a PA sees it", () => {
  it("gives every lead a classification and shows a draft only where a reply is due", async () => {
    const demo = await buildDemoData({ now: new Date("2026-09-30T20:00:00Z") });
    expect(demo.failures).toEqual([]);
    const board = await demo.board("team", null);
    const byName = new Map(board.rows.map((row) => [row.lead.name, row]));

    const priya = byName.get("Priya Natarajan")!;
    expect(priya.triage.kind).toBe("reply");
    expect(priya.triage.label).toBe("Qualified lead");
    expect(priya.triage.why).toMatch(/round robin to PA/);
    expect(priya.draft.status).toBe("ready");
    expect(priya.draft.preview).not.toMatch(/^Hi /);

    // The recorded residency draft breaks the message rules on purpose.
    const hannah = byName.get("Hannah Weiss")!;
    expect(hannah.draft.status).toBe("needs_edit");
    expect(hannah.triage.action).toMatch(/fix it/);

    const riley = byName.get("Riley Moss")!;
    expect(riley.triage.kind).toBe("review");
    expect(riley.draft.status).toBe("ready");

    // Every lead has an owner, so an owned account is classified by the lead
    // itself; the open deal and the customer are their own classes (D59).
    expect(byName.get("Marcus Lee")!.triage.label).toBe("Qualified lead");
    expect(byName.get("Marcus Lee")!.triage.why).toMatch(/Owned account/);
    expect(byName.get("Ines Duarte")!.triage.label).toBe("Open deal");
    expect(byName.get("Elena Petrova")!.triage.label).toBe("Existing customer");
    expect(byName.get("Sam Whitfield")!.triage.label).toBe("Support request");
    expect(byName.get("Leo Brandt")!.triage.label).toBe("Vendor pitch");
    expect(byName.get("test")!.triage.label).toBe("Spam or test");

    for (const row of board.rows) {
      if (row.triage.kind !== "reply" && row.triage.kind !== "review")
        expect(row.draft.status, row.lead.name ?? "").toBe("not_needed");
      expect(row.triage.why, row.lead.name ?? "").not.toMatch(/[—–]/);
    }

    const detail = await demo.engagement(hannah.id);
    expect(
      detail?.draft.problems.map((problem) => problem.code).sort(),
    ).toEqual([
      "banned_phrase",
      "banned_phrase",
      "banned_phrase",
      "calendar_link",
      "calls_to_action",
      "colon",
      "content_enterprise",
      "questions",
      "trigger",
    ]);
  });
});
