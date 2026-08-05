import { describe, expect, it } from "vitest";

import {
  backfillJobOrgId,
  buildRunContinuationJobContent,
  buildSourcingRuleJobContent,
  runContinuationJobName,
} from "../server/helpers/sourcing-rule-jobs.js";

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

  it("defaults to run-sourcing-rule-pipeline wording when actionName/ruleLabel are omitted", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
    });
    expect(content).toContain("Call run-sourcing-rule-pipeline with");
    expect(content).toContain("Execute prospecting-hub sourcing rule rule-123");
  });

  it("swaps in a different action/rule label for a different pipeline kind", () => {
    const content = buildSourcingRuleJobContent({
      cron: "0 */1 * * *",
      enabled: true,
      createdBy: "xdr@builder.io",
      ruleId: "rule-123",
      actionName: "run-marketing-rule-pipeline",
      ruleLabel: "marketing rule",
    });
    expect(content).toContain("Execute prospecting-hub marketing rule rule-123");
    expect(content).toContain("Call run-marketing-rule-pipeline with");
    expect(content).not.toContain("run-sourcing-rule-pipeline");
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

describe("runContinuationJobName", () => {
  it("is deterministic per rule", () => {
    expect(runContinuationJobName("rule-123")).toBe("sourcing-rule-rule-123-continuation");
    expect(runContinuationJobName("rule-123")).toBe(runContinuationJobName("rule-123"));
  });

  it("differs between rules", () => {
    expect(runContinuationJobName("rule-a")).not.toBe(runContinuationJobName("rule-b"));
  });
});

describe("buildRunContinuationJobContent", () => {
  const base = {
    ruleId: "rule-123",
    syncRecordId: "sync-abc",
    createdBy: "xdr@builder.io",
    orgId: "org-xyz",
  };

  it("fires every minute and embeds the exact ruleId/syncRecordId pair to resume", () => {
    const content = buildRunContinuationJobContent(base);
    expect(content).toContain('schedule: "* * * * *"');
    expect(content).toContain('{ ruleId: "rule-123", syncRecordId: "sync-abc" }');
  });

  it("instructs the job to delete itself by its own deterministic name", () => {
    const content = buildRunContinuationJobContent(base);
    expect(content).toContain(`name: "${runContinuationJobName("rule-123")}"`);
  });

  it("instructs the job to stop (not retry) when the run already finished", () => {
    const content = buildRunContinuationJobContent(base);
    expect(content.toLowerCase()).toContain("already finished");
    expect(content).toMatch(/do not retry/i);
  });

  it("embeds orgId, and omits it when not provided", () => {
    expect(buildRunContinuationJobContent(base)).toMatch(/^orgId: org-xyz$/m);
    expect(buildRunContinuationJobContent({ ...base, orgId: null })).not.toMatch(/orgId:/);
  });

  it("defaults to run-sourcing-rule-pipeline wording when actionName/ruleLabel are omitted", () => {
    const content = buildRunContinuationJobContent(base);
    expect(content).toContain("Call run-sourcing-rule-pipeline with EXACTLY");
    expect(content).toContain("prospecting-hub sourcing-rule run");
  });

  it("swaps in a different action/rule label for a different pipeline kind", () => {
    const content = buildRunContinuationJobContent({
      ...base,
      actionName: "run-marketing-rule-pipeline",
      ruleLabel: "marketing-rule",
    });
    expect(content).toContain("Call run-marketing-rule-pipeline with EXACTLY");
    expect(content).toContain("prospecting-hub marketing-rule run");
    expect(content).not.toContain("run-sourcing-rule-pipeline");
  });
});
