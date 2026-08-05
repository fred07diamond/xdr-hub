import { describe, expect, it } from "vitest";

import { backfillJobOrgId, buildSourcingRuleJobContent } from "../server/helpers/sourcing-rule-jobs.js";

describe("buildSourcingRuleJobContent", () => {
  it("embeds orgId in the frontmatter when provided", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
      orgId: "org-abc",
    });
    expect(content).toMatch(/^orgId: org-abc$/m);
  });

  it("omits the orgId line when not provided", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
      orgId: null,
    });
    expect(content).not.toMatch(/orgId:/);
  });

  it("keeps every other frontmatter field and the instructions body unchanged", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */2 * * *",
      enabled: false,
      createdBy: "xdr@builder.io",
      ruleId: "rule-456",
      orgId: "org-xyz",
    });
    expect(content).toContain('schedule: "0 */2 * * *"');
    expect(content).toContain("enabled: false");
    expect(content).toContain("createdBy: xdr@builder.io");
    expect(content).toContain("runAs: creator");
    expect(content).toContain("Execute prospecting-hub sourcing rule rule-456");
  });
});

describe("backfillJobOrgId", () => {
  it("inserts orgId before runAs when missing", () => {
    const before = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
      // Simulates a job created before this fix — no orgId at all.
    });
    expect(before).not.toMatch(/orgId:/);

    const after = backfillJobOrgId(before, "org-abc");
    expect(after).toMatch(/^orgId: org-abc$/m);
    expect(after).toContain('schedule: "0 */1 * * *"');
    expect(after).toContain("runAs: creator");
  });

  it("is a no-op when orgId is already present", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
      orgId: "org-existing",
    });
    expect(backfillJobOrgId(content, "org-different")).toBe(content);
  });

  it("is a no-op on malformed frontmatter instead of throwing", () => {
    const malformed = "not a job file";
    expect(backfillJobOrgId(malformed, "org-abc")).toBe(malformed);
  });
});
