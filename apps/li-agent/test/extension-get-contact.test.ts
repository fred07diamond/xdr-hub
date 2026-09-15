import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contact lookup from the extension, for the case the dashboard is bad at:
// you are on someone's profile and want to call them now.
//
// The whole risk here is that an extension-facing endpoint becomes a side door
// around the credit system. These tests exist to pin that it is not.

function src(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("extension-get-contact — not a side door", () => {
  const SRC = src("actions/extension-get-contact.ts");

  it("goes through the SHARED enrichment choke point for email", () => {
    // enrichApolloRecord requires a branded CreditAuthorization, so bypassing
    // the guard is a compile error rather than a convention.
    expect(SRC).toContain("enrichApolloRecord");
    expect(SRC).not.toContain("matchApolloPerson");
    expect(SRC).not.toContain("apolloFetch");
  });

  it("goes through the SHARED gates for phone", () => {
    // Not its own copy of the hundred lines of spend policy. This codebase
    // already has the receipt for what duplicating that costs.
    expect(SRC).toContain("revealPhoneForRecord");
    expect(SRC).not.toContain("getEnrichmentBudgetState");
    expect(SRC).not.toContain("verdictClearsBar");
  });

  it("requires the caller to echo the 8-credit cost for a phone", () => {
    // A stale extension must not be able to spend 8 credits by accident.
    expect(SRC).toContain('code: "cost_not_confirmed"');
    expect(SRC).toMatch(/wantPhone && confirmCredits !== REVEAL_CREDITS/);
  });

  it("scopes the lookup to the caller's own prospect", () => {
    // A lookup spends shared credits, so it must not be possible to trigger
    // one against someone else's lead.
    expect(SRC).toContain("resolveOwnerStrict");
    expect(SRC).toContain("eq(prospects.ownerEmail, actorEmail)");
  });

  it("defaults phone to OFF", () => {
    // Email is 1 credit; a phone is 8. The expensive leg is opt-in per call.
    expect(SRC).toMatch(/wantPhone: z\.boolean\(\)\.default\(false\)/);
    expect(SRC).toMatch(/wantEmail: z\.boolean\(\)\.default\(true\)/);
  });

  it("skips the email call when one is already stored", () => {
    // Re-buying data we hold is the most avoidable kind of waste.
    expect(SRC).toContain("if (wantEmail && !row.enrichedEmail)");
  });

  it("re-reads before revealing, so a synchronous phone saves the 8 credits", () => {
    // The email enrichment can surface a phone on the same Apollo response.
    // Without the re-read, the reveal would run anyway and pay for a number
    // we had just received.
    expect(SRC).toMatch(/const \[fresh\] = await db[\s\S]{0,200}if \(current\.enrichedPhone\)/);
  });

  it("offers an override ONLY for the fit gate", () => {
    // The budget tier is policy, not a nag. Offering an override for it would
    // be a lie, since the server would refuse anyway.
    expect(SRC).toMatch(/canOverride = reveal\.code === "fit_gate"/);
  });

  it("reports per-leg errors so a failed phone does not hide a found email", () => {
    expect(SRC).toContain("emailError");
    expect(SRC).toContain("phoneError");
  });

  it("declares NO audit block, which is what makes it reachable", () => {
    // The framework's audit layer needs a resolved actor, so an audited action
    // is rejected with {"error":"Unauthorized"} before schema validation. This
    // was the ONLY public action in the app carrying one, and that is why the
    // extension buttons did nothing.
    //
    // The spend is still attributable: apollo_credit_ledger records
    // actorEmail, trigger, fit verdict at spend time and the override flag for
    // every credit, which is what Export ledger reads.
    expect(SRC).not.toMatch(/^\s*audit: \{/m);
  });
});

describe("the gates were EXTRACTED, not copied", () => {
  const HELPER = src("server/helpers/reveal-phone-for-record.ts");
  const ACTION = src("actions/reveal-phone.ts");

  it("the dashboard action now delegates to the helper", () => {
    expect(ACTION).toContain("revealPhoneForRecord");
    // The gates must not exist in two places, or they drift -- which is
    // exactly how the enrichment logic came to spend 9 credits per lead.
    expect(ACTION).not.toContain("verdictClearsBar");
    expect(ACTION).not.toContain("state.phoneRevealsPaused");
  });

  it("the helper keeps the budget tier ahead of the fit gate", () => {
    // Order is load-bearing: checking the tier first is what makes the
    // "paused" message explain the real blocker instead of telling someone to
    // improve a lead they cannot reveal anyway.
    const paused = HELPER.indexOf('code: "phone_budget_blocked"');
    const fit = HELPER.indexOf('code: "fit_gate"');
    expect(paused).toBeGreaterThan(-1);
    expect(fit).toBeGreaterThan(paused);
  });

  it("the helper keeps every zero-spend short circuit before the budget read", () => {
    const already = HELPER.indexOf('code: "already_revealed"');
    const pending = HELPER.indexOf('code: "reveal_pending"');
    const noNumber = HELPER.indexOf('code: "no_number_known"');
    // The CALL SITE, not the import at the top of the file. Measuring the
    // import is a mistake already made once in this suite: every call site
    // sorts after it, so the assertion passes regardless of real order.
    const budget = HELPER.indexOf("await getEnrichmentBudgetState()");
    for (const [name, i] of [["already", already], ["pending", pending], ["no_number", noNumber]] as const) {
      expect(i, name).toBeGreaterThan(-1);
      expect(i, name).toBeLessThan(budget);
    }
  });
});

describe("extension wiring", () => {
  it("background echoes the cost only for a phone request", () => {
    const SRC = src("extension/background.js");
    expect(SRC).toContain("async function getContact");
    expect(SRC).toMatch(/confirmCredits: wantPhone \? 8 : null/);
  });

  it("panel clears contact details on every profile change", () => {
    // Showing the PREVIOUS person's number next to this person's name could
    // put the wrong number in a dialer.
    const SRC = src("extension/panel.js");
    expect(SRC).toContain("resetContactSection()");
    expect(SRC).toContain("function resetContactSection");
  });

  it("panel offers a tel: link once a number exists", () => {
    // The whole point is a one-off call being one click.
    expect(src("extension/panel.js")).toMatch(/contactPhoneCall\.href = `tel:/);
  });

  it("panel does not re-offer a reveal that is already in flight", () => {
    // Apollo delivers by callback; a second request is another 8 credits for
    // the same answer.
    expect(src("extension/panel.js")).toMatch(/phoneRevealStatus === "requested"[\s\S]{0,200}disabled = true/);
  });
});

describe("the action must be reachable by the extension at all", () => {
  const SRC = readFileSync(new URL("../actions/extension-get-contact.ts", import.meta.url), "utf8");

  it("declares no http block either, matching the other extension actions", () => {
    // This is why the buttons did nothing. `http: { method: "POST" }` creates
    // a direct HTTP route whose auth is separate from the publicAgent path, so
    // the request was rejected by the framework with a bare
    // {"error":"Unauthorized"} before `run` executed -- which is why the
    // action's own "add your API token" message never appeared.
    //
    // Not the cause of the Unauthorized -- that was the audit block -- but
    // kept off for consistency with capture-profile, import-sales-nav-list
    // and ingest-post-engager, none of which declare one.
    expect(SRC).not.toMatch(/^\s*http: \{/m);
  });

  it("matches the declaration every other extension write action uses", () => {
    expect(SRC).toContain("requiresAuth: false");
    expect(SRC).toContain("publicAgent: { expose: true, readOnly: false, requiresAuth: false }");
  });
});

describe("contact details live in the profile card", () => {
  it("the block sits inside #profile-card, not as its own panel", () => {
    // As a separate grey panel below the buttons it read as a feature bolted
    // on, and put two competing card surfaces on a narrow side panel. The
    // profile card already holds who this person is.
    const HTML = readFileSync(new URL("../extension/panel.html", import.meta.url), "utf8");
    const cardStart = HTML.indexOf('<div id="profile-card">');
    const contact = HTML.indexOf('<div id="contact-section"');
    const statusDiv = HTML.indexOf('<div id="status"></div>');
    expect(cardStart).toBeGreaterThan(-1);
    expect(contact).toBeGreaterThan(cardStart);
    // And before the action buttons / status line that used to precede it.
    expect(contact).toBeLessThan(statusDiv);
  });

  it("appears exactly once", () => {
    const HTML = readFileSync(new URL("../extension/panel.html", import.meta.url), "utf8");
    expect(HTML.match(/id="contact-section"/g)).toHaveLength(1);
  });
});
